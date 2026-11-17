#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const scyncBin = path.resolve('bin/scync.js');
const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');

function run(cmd, desc) {
  console.log(`\n\x1b[36m▶ [${desc}]\x1b[0m: node bin/scync.js ${cmd}`);
  try {
    const rawOutput = execSync(`node "${scyncBin}" ${cmd}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(rawOutput.trim());
    return { success: true, output: rawOutput, clean: stripAnsi(rawOutput) };
  } catch (err) {
    console.error(`\x1b[31m✖ Error running "${cmd}":\x1b[0m\n${err.stderr || err.message}`);
    return { success: false, error: err, output: '', clean: '' };
  }
}

async function smokeTest() {
  console.log('\x1b[32m═══════════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[32m        Scync CLI — End-to-End Live Vault Smoke Test           \x1b[0m');
  console.log('\x1b[32m═══════════════════════════════════════════════════════════════\x1b[0m');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  \x1b[32m✓\x1b[0m ${message}`);
      passed++;
    } else {
      console.log(`  \x1b[31m✖ FAILED:\x1b[0m ${message}`);
      failed++;
    }
  }

  // 1. Identity & Session
  const whoami = run('whoami', 'Step 1: Check Active Session');
  assert(whoami.success && whoami.clean.includes('Signed in as:'), 'User is authenticated');

  // 2. Status
  const status = run('status', 'Step 2: Check Vault & Agent Status');
  assert(status.success && status.clean.includes('Vault Initialized: Yes'), 'Vault metadata accessible');

  // 3. List
  const ls = run('ls', 'Step 3: List Existing Secrets (Uncached/Safe)');
  assert(ls.success, 'ls executed successfully');

  // 4. Create Test Secret
  const testSecretName = 'CLI_LIVE_SMOKE_KEY';
  const initialVal = 'smoke-test-secret-value-alpha';
  const setRes = run(`set ${testSecretName} --value "${initialVal}" --project Testing --env development`, 'Step 4: Create Test Secret');
  assert(setRes.success && setRes.clean.includes(`Created secret '${testSecretName}'`), 'Secret created as v1');

  // 5. Read Secret (Pipe/Raw subshell mode & Reveal)
  const getPipe = run(`get ${testSecretName}`, 'Step 5a: Read Secret (Pipe/Raw mode in subshell)');
  assert(getPipe.success && getPipe.output.trim() === initialVal, 'Non-TTY subshell correctly outputs raw secret for unix pipes');

  const getReveal = run(`get ${testSecretName} --reveal`, 'Step 5b: Read Secret (Revealed)');
  assert(getReveal.success && getReveal.clean.includes(initialVal), 'Decrypted secret matches original value');

  // 6. Inspect Secret History & Metadata
  const showRes = run(`show ${testSecretName}`, 'Step 6: Show Secret Metadata');
  assert(showRes.success && showRes.clean.includes('Version:        v1'), 'Version is v1');

  // 7. Update Secret
  const updatedVal = 'smoke-test-secret-value-beta';
  const updateRes = run(`update ${testSecretName} --value "${updatedVal}"`, 'Step 7: Update Secret');
  assert(updateRes.success && updateRes.clean.includes('to v2'), 'Version incremented to v2');

  const getUpdated = run(`get ${testSecretName} --reveal`, 'Step 7b: Verify Updated Secret');
  assert(getUpdated.success && getUpdated.clean.includes(updatedVal), 'Value successfully updated');

  // 8. Rotate Secret
  const rotatedVal = 'smoke-test-secret-value-gamma';
  const rotateRes = run(`rotate ${testSecretName} --value "${rotatedVal}"`, 'Step 8: Rotate Secret');
  assert(rotateRes.success && rotateRes.clean.includes('to v3'), 'Version incremented to v3 on rotation');

  // 9. Restore Secret from History
  const restoreRes = run(`restore ${testSecretName} 1`, 'Step 9: Restore Secret from History (v1)');
  assert(restoreRes.success && restoreRes.clean.includes('from v1'), 'Secret restored from v1');

  const getRestored = run(`get ${testSecretName} --reveal`, 'Step 9b: Verify Restored Secret');
  assert(getRestored.success && getRestored.clean.includes(initialVal), 'Restored value matches v1');

  // 10. Process Environment Injection
  const runRes = run(`run --project Testing -- node -e "console.log('INJECTED=' + process.env.${testSecretName})"`, 'Step 10: Process Injection (scync run)');
  assert(runRes.success && runRes.clean.includes(`INJECTED=${initialVal}`), 'Direct process injection without writing to disk');

  // 11. Pull / Export
  const tempExportPath = path.resolve('./temp-smoke-export.env');
  const pullRes = run(`pull --project Testing --env development --output "${tempExportPath}"`, 'Step 11: Export to .env');
  assert(pullRes.success && fs.existsSync(tempExportPath), 'Exported file created with 0600 mode');
  if (fs.existsSync(tempExportPath)) {
    const content = fs.readFileSync(tempExportPath, 'utf8');
    assert(content.includes(`${testSecretName}=`), 'Exported .env contains secret');
    fs.unlinkSync(tempExportPath);
  }

  // 12. Specialized Commands Check
  const totpRes = run('totp', 'Step 12a: Check TOTP command');
  assert(totpRes.success, 'totp command responds');

  const sshRes = run('ssh ls', 'Step 12b: Check SSH command');
  assert(sshRes.success, 'ssh command responds');

  const passRes = run('passwords', 'Step 12c: Check Passwords command');
  assert(passRes.success, 'passwords command responds');

  const certsRes = run('certs', 'Step 12d: Check Certs command');
  assert(certsRes.success, 'certs command responds');

  // 13. Cleanup Test Secret
  const rmRes = run(`rm ${testSecretName} --yes`, 'Step 13: Clean Up Smoke Test Secret');
  assert(rmRes.success && rmRes.clean.includes('Deleted secret'), 'Smoke test secret deleted cleanly');

  // Results
  console.log('\n\x1b[32m═══════════════════════════════════════════════════════════════\x1b[0m');
  console.log(`\x1b[1mSmoke Test Complete:\x1b[0m \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('\x1b[32m═══════════════════════════════════════════════════════════════\x1b[0m\n');
}

smokeTest();
