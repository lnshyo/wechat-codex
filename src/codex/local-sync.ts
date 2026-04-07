import { splitMessage } from '../gateway/task-utils.js';
import type { Session } from '../session.js';
import { readTranscriptEventsSince } from './transcript.js';

interface SenderLike {
  sendText(toUserId: string, contextToken: string, text: string): Promise<void>;
}

interface SessionStoreLike {
  list(accountId: string): Session[];
  update(
    accountId: string,
    peerUserId: string,
    updater: (session: Session) => Session | void,
  ): Session;
}

interface SuppressedEvent {
  role: 'assistant';
  text: string;
  expiresAt: number;
}

function maxTimestamp(left?: string, right?: string): string | undefined {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left >= right ? left : right;
}

export function createLocalCodexTranscriptMirror(deps: {
  accountId: string;
  sessionStore: SessionStoreLike;
  sender: SenderLike;
  pollIntervalMs?: number;
}) {
  const suppressions = new Map<string, SuppressedEvent[]>();
  const pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  let interval: NodeJS.Timeout | undefined;
  let polling = false;

  function pruneSuppressed(sessionId: string): SuppressedEvent[] {
    const now = Date.now();
    const active = (suppressions.get(sessionId) || []).filter((event) => event.expiresAt > now);
    if (active.length > 0) {
      suppressions.set(sessionId, active);
    } else {
      suppressions.delete(sessionId);
    }
    return active;
  }

  function isSuppressed(sessionId: string, text: string): boolean {
    const active = pruneSuppressed(sessionId);
    const index = active.findIndex((event) => event.text === text);
    if (index === -1) {
      return false;
    }

    active.splice(index, 1);
    if (active.length > 0) {
      suppressions.set(sessionId, active);
    } else {
      suppressions.delete(sessionId);
    }
    return true;
  }

  function registerBridgeTurn(sessionId: string, _promptText: string, resultText?: string): void {
    if (!resultText) {
      return;
    }

    const expiresAt = Date.now() + 60_000;
    const current = pruneSuppressed(sessionId);
    current.push({ role: 'assistant', text: resultText, expiresAt });
    suppressions.set(sessionId, current);
  }

  async function mirrorText(toUserId: string, contextToken: string, text: string): Promise<void> {
    for (const chunk of splitMessage(text)) {
      await deps.sender.sendText(toUserId, contextToken, chunk);
    }
  }

  async function primeExistingSessions(): Promise<void> {
    for (const session of deps.sessionStore.list(deps.accountId)) {
      if (!session.localSync?.enabled) {
        continue;
      }

      const { transcriptCursor, transcriptPath } = session.localSync;
      const result = await readTranscriptEventsSince(transcriptPath, transcriptCursor);
      const nextWatermark = result.events.reduce(
        (watermark, event) => maxTimestamp(watermark, event.timestamp),
        session.localSync.lastTranscriptEventAt,
      );

      if (result.cursor === transcriptCursor && nextWatermark === session.localSync.lastTranscriptEventAt) {
        continue;
      }

      deps.sessionStore.update(deps.accountId, session.peerUserId, (current) => ({
        ...current,
        localSync: current.localSync
          ? {
              ...current.localSync,
              transcriptCursor: result.cursor,
              lastTranscriptEventAt: nextWatermark || current.localSync.lastTranscriptEventAt,
            }
          : current.localSync,
      }));
    }
  }

  async function pollOnce(): Promise<void> {
    if (polling) {
      return;
    }

    polling = true;

    try {
      for (const session of deps.sessionStore.list(deps.accountId)) {
        if (!session.localSync?.enabled) {
          continue;
        }

        const { sessionId, transcriptCursor, transcriptPath } = session.localSync;
        const watermark = session.localSync.lastTranscriptEventAt;
        const result = await readTranscriptEventsSince(transcriptPath, transcriptCursor);
        const nextWatermark = result.events.reduce(
          (currentWatermark, event) => maxTimestamp(currentWatermark, event.timestamp),
          watermark,
        );

        if (result.cursor !== transcriptCursor || nextWatermark !== watermark) {
          deps.sessionStore.update(deps.accountId, session.peerUserId, (current) => ({
            ...current,
            localSync: current.localSync
              ? {
                  ...current.localSync,
                  transcriptCursor: result.cursor,
                  lastTranscriptEventAt: nextWatermark || current.localSync.lastTranscriptEventAt,
                }
              : current.localSync,
          }));
        }

        for (const event of result.events) {
          if (event.role !== 'assistant') {
            continue;
          }

          if (watermark && event.timestamp <= watermark) {
            continue;
          }

          if (isSuppressed(sessionId, event.text)) {
            continue;
          }

          await mirrorText(session.peerUserId, session.latestContextToken || '', event.text);
        }
      }
    } finally {
      polling = false;
    }
  }

  function start(): void {
    if (!interval) {
      void primeExistingSessions();
      interval = setInterval(() => {
        void pollOnce();
      }, pollIntervalMs);
    }
  }

  function stop(): void {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  }

  return {
    start,
    stop,
    pollOnce,
    primeExistingSessions,
    registerBridgeTurn,
  };
}
