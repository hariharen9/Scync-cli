import type { UserCredential, User } from 'firebase/auth';
import { loadSession, saveSession, clearSession, type StoredSession } from './storage.js';
import { DEFAULT_CONFIG, ensureAuthReady } from '../core/firebase.js';
import { getAuthMaxAgeMs } from '../config/index.js';

export class AuthExpiredError extends Error {
  constructor(message = "Session expired or revoked. Please run 'scync login'.") {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

/**
 * Absolute expiry for a stored login. Falls back to `savedAt` for sessions
 * written before the cap existed so existing users are not surprised mid-use.
 */
export function sessionAuthDeadline(session: StoredSession): number {
  if (typeof session.authValidUntil === 'number' && Number.isFinite(session.authValidUntil)) {
    return session.authValidUntil;
  }
  const maxAge = getAuthMaxAgeMs();
  if (maxAge <= 0) return Number.POSITIVE_INFINITY;
  const saved = Date.parse(session.savedAt);
  return (Number.isFinite(saved) ? saved : Date.now()) + maxAge;
}

export function isSessionWithinMaxAge(session: StoredSession, now = Date.now()): boolean {
  return now < sessionAuthDeadline(session);
}

export async function createSessionFromUser(user: User, providerId: 'google.com' | 'password'): Promise<StoredSession> {
  const tokenResult = await user.getIdTokenResult();
  const maxAge = getAuthMaxAgeMs();
  const session: StoredSession = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    refreshToken: user.refreshToken,
    idToken: tokenResult.token,
    expiresAt: new Date(tokenResult.expirationTime).getTime(),
    providerId,
    savedAt: new Date().toISOString(),
    authValidUntil: maxAge > 0 ? Date.now() + maxAge : undefined
  };

  saveSession(session);
  return session;
}

export async function refreshSessionToken(session: StoredSession, apiKey = DEFAULT_CONFIG.apiKey): Promise<StoredSession> {
  const useEmulators = DEFAULT_CONFIG.useEmulators;
  const tokenEndpoint = useEmulators
    ? `${DEFAULT_CONFIG.authEmulatorUrl}/securetoken.googleapis.com/v1/token?key=${apiKey}`
    : `https://securetoken.googleapis.com/v1/token?key=${apiKey}`;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken
  });

  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      clearSession();
      throw new AuthExpiredError();
    }
    const errText = await res.text().catch(() => '');
    throw new Error(`Authentication token refresh failed (HTTP ${res.status}): ${errText}`);
  }

  const data = await res.json() as {
    access_token: string;
    id_token: string;
    refresh_token: string;
    expires_in: string;
  };

  const deadline = sessionAuthDeadline(session);
  const updatedSession: StoredSession = {
    ...session,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (Number(data.expires_in) * 1000),
    savedAt: new Date().toISOString(),
    // Refreshing a token never extends the absolute login lifetime.
    authValidUntil: Number.isFinite(deadline) ? deadline : undefined
  };

  saveSession(updatedSession);
  return updatedSession;
}

export async function getValidSession(): Promise<StoredSession | null> {
  const session = loadSession();
  if (!session) return null;

  // Enforce the absolute login lifetime before refreshing anything.
  if (!isSessionWithinMaxAge(session)) {
    clearSession();
    return null;
  }

  // In emulator or live mode, ensure Firebase Auth is initialized and has a valid currentUser
  const auth = await ensureAuthReady();
  if (!auth.currentUser || auth.currentUser.uid !== session.uid) {
    return null;
  }

  // If token is about to expire within 2 minutes, refresh it
  if (Date.now() > session.expiresAt - 120_000) {
    try {
      return await refreshSessionToken(session);
    } catch (err) {
      if (err instanceof AuthExpiredError) return null;
      throw err;
    }
  }

  return session;
}
