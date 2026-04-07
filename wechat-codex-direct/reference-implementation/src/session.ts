import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { SESSIONS_DIR } from './constants.js';
import { createGatewayState, normalizeGatewayState } from './gateway/tokens.js';
import type { GatewaySessionState } from './gateway/types.js';
import { loadJson, saveJson } from './store.js';

export type SessionState = 'idle' | 'processing';
export type PersistedTypingState = 'idle' | 'typing' | 'generating';

export interface Session {
  peerUserId: string;
  codexThreadId?: string;
  latestContextToken?: string;
  state: SessionState;
  typingState: PersistedTypingState;
  gateway: GatewaySessionState;
  updatedAt: string;
}

function validatePathSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_.@=-]+$/.test(value)) {
    throw new Error(`Invalid ${label}: "${value}"`);
  }
}

function getSessionPath(accountId: string, peerUserId: string): string {
  validatePathSegment(accountId, 'accountId');
  validatePathSegment(peerUserId, 'peerUserId');
  return join(SESSIONS_DIR, accountId, `${peerUserId}.json`);
}

function normalizeSession(peerUserId: string, session: Partial<Session> | undefined): Session {
  return {
    peerUserId,
    codexThreadId: session?.codexThreadId,
    latestContextToken: session?.latestContextToken,
    state: session?.state ?? 'idle',
    typingState: session?.typingState ?? 'idle',
    gateway: normalizeGatewayState(session?.gateway ?? createGatewayState()),
    updatedAt: session?.updatedAt ?? new Date(0).toISOString(),
  };
}

export function createSessionStore() {
  function load(accountId: string, peerUserId: string): Session {
    const session = loadJson<Partial<Session>>(getSessionPath(accountId, peerUserId), {});
    return normalizeSession(peerUserId, session);
  }

  function save(accountId: string, session: Session): void {
    mkdirSync(join(SESSIONS_DIR, accountId), { recursive: true });

    const normalized = normalizeSession(session.peerUserId, {
      ...session,
      updatedAt: new Date().toISOString(),
    });

    saveJson(getSessionPath(accountId, session.peerUserId), normalized);
  }

  function clear(accountId: string, peerUserId: string): Session {
    const cleared = normalizeSession(peerUserId, {
      state: 'idle',
      typingState: 'idle',
    });

    save(accountId, cleared);
    return cleared;
  }

  function update(
    accountId: string,
    peerUserId: string,
    updater: (session: Session) => Session | void,
  ): Session {
    const current = load(accountId, peerUserId);
    const updated = updater({ ...current }) ?? current;
    save(accountId, updated);
    return updated;
  }

  return { load, save, clear, update };
}
