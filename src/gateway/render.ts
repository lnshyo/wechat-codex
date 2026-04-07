import type { Session } from '../session.js';
import type { GatewayHealthSnapshot, PeerRuntimeSnapshot, QueuedTask } from './types.js';

function renderSessionState(state: Session['state']): string {
  return state === 'processing' ? '\u5904\u7406\u4e2d' : '\u7a7a\u95f2';
}

function renderThreadState(threadId: string | undefined): string {
  return threadId ? '\u5df2\u4fdd\u5b58' : '\u65e0';
}

function renderLocalSyncState(session: Session): string {
  if (!session.localSync?.enabled) {
    return '\u672a\u8fde\u63a5';
  }

  return `\u5df2\u8fde\u63a5\uff08${session.localSync.sessionId}\uff09`;
}

function renderTaskStatus(status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'): string {
  switch (status) {
    case 'queued':
      return '\u6392\u961f\u4e2d';
    case 'running':
      return '\u6267\u884c\u4e2d';
    case 'completed':
      return '\u5df2\u5b8c\u6210';
    case 'failed':
      return '\u5931\u8d25';
    case 'aborted':
      return '\u5df2\u4e2d\u6b62';
  }
}

function renderTaskLine(task: QueuedTask, label: string): string {
  const imageSuffix = task.hasImage ? ' +\u56fe\u7247' : '';
  return `${label} #${task.id} \u4e8e ${task.createdAt}${imageSuffix}\n${task.preview}`;
}

export function renderStatus(session: Session, snapshot: PeerRuntimeSnapshot): string {
  const lines = [
    '\u4f1a\u8bdd\u72b6\u6001',
    `\u5f53\u524d\u72b6\u6001\uff1a${renderSessionState(session.state)}`,
    `\u7ebf\u7a0b\uff1a${renderThreadState(session.codexThreadId)}`,
    `\u672c\u5730\u7a97\u53e3\u540c\u6b65\uff1a${renderLocalSyncState(session)}`,
    `\u5f53\u524d\u4efb\u52a1\uff1a${snapshot.activeTask ? `#${snapshot.activeTask.id}` : '\u65e0'}`,
    `\u6392\u961f\u4efb\u52a1\uff1a${snapshot.queuedTasks.length}`,
    `\u5df2\u63d0\u4ea4 Token\uff08\u4f30\u7b97\uff09\uff1a${session.gateway.tokenLedger.estimatedCommittedTokens}`,
    `\u5904\u7406\u4e2d Token\uff08\u4f30\u7b97\uff09\uff1a${session.gateway.tokenLedger.estimatedPendingTokens}`,
    `\u5269\u4f59 Token\uff08\u4f30\u7b97\uff09\uff1a${session.gateway.tokenLedger.estimatedRemainingTokens}`,
  ];

  if (session.gateway.lastTaskSummary) {
    lines.push(
      `\u6700\u8fd1\u4efb\u52a1\uff1a#${session.gateway.lastTaskSummary.taskId} ${renderTaskStatus(session.gateway.lastTaskSummary.status)}`,
    );
  }

  if (session.gateway.lastError) {
    lines.push(`\u6700\u8fd1\u9519\u8bef\uff1a${session.gateway.lastError}`);
  }

  return lines.join('\n');
}

export function renderTokenSummary(session: Session): string {
  const ledger = session.gateway.tokenLedger;
  return [
    '\u4f1a\u8bdd Token \u7edf\u8ba1\uff08\u4f30\u7b97\uff09',
    `\u9884\u7b97\uff1a${ledger.budgetTokens}`,
    `\u56de\u590d\u9884\u7559\uff1a${ledger.reservedReplyTokens}`,
    `\u5df2\u63d0\u4ea4\uff1a${ledger.estimatedCommittedTokens}`,
    `\u5904\u7406\u4e2d\uff1a${ledger.estimatedPendingTokens}`,
    `\u5269\u4f59\uff1a${ledger.estimatedRemainingTokens}`,
    `\u8f6e\u6b21\u6570\uff1a${ledger.turns.length}`,
  ].join('\n');
}

export function renderTaskQueue(snapshot: PeerRuntimeSnapshot): string {
  if (!snapshot.activeTask && snapshot.queuedTasks.length === 0) {
    return '\u5f53\u524d\u804a\u5929\u6ca1\u6709\u8fd0\u884c\u4e2d\u6216\u6392\u961f\u4e2d\u7684\u4efb\u52a1\u3002';
  }

  const lines = ['\u4efb\u52a1\u961f\u5217'];

  if (snapshot.activeTask) {
    lines.push(renderTaskLine(snapshot.activeTask, '\u6267\u884c\u4e2d'));
  }

  snapshot.queuedTasks.forEach((task, index) => {
    lines.push(renderTaskLine(task, `\u6392\u961f ${index + 1}`));
  });

  return lines.join('\n\n');
}

export function renderHealth(snapshot: GatewayHealthSnapshot): string {
  const lines = [
    '\u6865\u63a5\u5065\u5eb7\u72b6\u6001',
    `\u8fdb\u7a0b\uff1a\u8fd0\u884c\u4e2d\uff08PID ${snapshot.bridgeProcessId}\uff09`,
    snapshot.serviceRunning
      ? `\u540e\u53f0\u670d\u52a1\uff1a\u8fd0\u884c\u4e2d${snapshot.servicePid ? `\uff08PID ${snapshot.servicePid}\uff09` : ''}`
      : '\u540e\u53f0\u670d\u52a1\uff1a\u672a\u8fd0\u884c',
    `\u5fae\u4fe1\u8d26\u53f7\uff1a${snapshot.accountId}`,
    snapshot.codexExecutablePath
      ? `Codex \u53ef\u6267\u884c\u6587\u4ef6\uff1a${snapshot.codexExecutablePath}`
      : `Codex \u53ef\u6267\u884c\u6587\u4ef6\uff1a\u4e0d\u53ef\u7528${snapshot.codexExecutableError ? `\uff08${snapshot.codexExecutableError}\uff09` : ''}`,
    `\u6d3b\u8dc3\u8054\u7cfb\u4eba\uff1a${snapshot.activePeerCount}`,
    `\u6392\u961f\u4efb\u52a1\uff1a${snapshot.totalQueuedTasks}`,
  ];

  if (snapshot.serviceStartedAt) {
    lines.push(`\u540e\u53f0\u670d\u52a1\u542f\u52a8\u65f6\u95f4\uff1a${snapshot.serviceStartedAt}`);
  }

  if (snapshot.lastRuntimeError) {
    lines.push(`\u6700\u8fd1\u8fd0\u884c\u9519\u8bef\uff1a${snapshot.lastRuntimeError}`);
  }

  return lines.join('\n');
}
