export function generateBashCompletion(): string {
  return `
# scync bash completion
_scync_completions() {
  local cur prev commands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="login logout whoami status unlock lock ls get show set update rotate restore rm pull push run watch config completion"

  case "\${prev}" in
    get|show|update|rotate|restore|rm)
      return 0
      ;;
    config)
      COMPREPLY=( $(compgen -W "list get set unset" -- "\${cur}") )
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "\${cur}") )
      return 0
      ;;
    *)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      return 0
      ;;
  esac
}
complete -F _scync_completions scync
`.trim();
}

export function generateZshCompletion(): string {
  return `
#compdef scync

_scync() {
  local -a commands
  commands=(
    'login:Authenticate with your Firebase account'
    'logout:Sign out and remove stored session'
    'whoami:Display active user identity'
    'status:Show vault and agent security status'
    'unlock:Unlock vault with master password and start background agent'
    'lock:Lock vault and terminate background agent custody'
    'ls:List secrets with metadata filtering'
    'get:Retrieve secret value'
    'show:Display comprehensive secret metadata and history'
    'set:Create a new secret or update with confirmation'
    'update:Modify secret value or metadata'
    'rotate:Rotate secret value and record timestamp'
    'restore:Restore previous version from history'
    'rm:Delete secret'
    'pull:Export secrets to .env file'
    'push:Import secrets from .env file'
    'run:Run command with secrets injected into environment'
    'watch:Observe secret changes in real time'
    'config:Manage local CLI configuration'
    'completion:Generate shell autocompletion script'
  )

  _arguments -C \\
    '1: :->command' \\
    '*:: :->args'

  case $state in
    command)
      _describe -t commands 'scync command' commands
      ;;
  esac
}

_scync "$@"
`.trim();
}

export function generatePowerShellCompletion(): string {
  return `
Register-ArgumentCompleter -Native -CommandName scync -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $commands = @(
        'login', 'logout', 'whoami', 'status', 'unlock', 'lock',
        'ls', 'get', 'show', 'set', 'update', 'rotate', 'restore', 'rm',
        'pull', 'push', 'run', 'watch', 'config', 'completion'
    )
    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
`.trim();
}

export async function completionCommand(shell?: string): Promise<void> {
  const target = (shell || 'bash').toLowerCase();
  switch (target) {
    case 'bash':
      console.log(generateBashCompletion());
      break;
    case 'zsh':
      console.log(generateZshCompletion());
      break;
    case 'powershell':
    case 'pwsh':
      console.log(generatePowerShellCompletion());
      break;
    case 'fish':
      console.log('complete -c scync -f -a "login logout whoami status unlock lock ls get show set update rotate restore rm pull push run watch config completion"');
      break;
    default:
      console.error(`Unsupported shell: ${shell}. Supported shells: bash, zsh, fish, powershell`);
      process.exitCode = 1;
  }
}
