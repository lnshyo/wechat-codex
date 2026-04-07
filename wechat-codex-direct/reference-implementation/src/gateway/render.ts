import type { Session } from '../session.js';
import type { GatewayHealthSnapshot, PeerRuntimeSnapshot, QueuedTask } from './types.js';

function renderTaskLine(task: QueuedTask, label: string): string {
  const imageSuffix = task.hasImage ? ' +image' : '';
  return `${label} #${task.id} · ${task.createdAt}${imageSuffix}\n${task.preview}`;
}

export function renderStatus(session: Session, snapshot: PeerRuntimeSnapshot): string {
  const lines = [
    'Session status',
    `State: ${session.state}`,
    `Thread: ${session.codexThreadId ? 'saved' : 'none'}`,
    `Active task: ${snapshot.activeTask ? `#${snapshot.activeTask.id}` : 'none'}`,
    `Queued tasks: ${snapshot.queuedTasks.length}`,
    `Committed tokens (estimated): ${session.gateway.tokenLedger.estimatedCommittedTokens}`,
    `Pending tokens (estimated): ${session.gateway.tokenLedger.estimatedPendingTokens}`,
    `Remaining tokens (estimated): ${session.gateway.tokenLedger.estimatedRemainingTokens}`,
  ];

  if (session.gateway.lastTaskSummary) {
    lines.push(
      `Last task: #${session.gateway.lastTaskSummary.taskId} ${session.gateway.lastTaskSummary.status}`,
    );
  }

  if (session.gateway.lastError) {
    lines.push(`Last error: ${session.gateway.lastError}`);
  }

  return lines.join('\n');
}

export function renderTokenSummary(session: Session): string {
  const ledger = session.gateway.tokenLedger;
  return [
    'Session tokens (estimated)',
    `Budget: ${ledger.budgetTokens}`,
    `Reply reserve: ${ledger.reservedReplyTokens}`,
    `Committed: ${ledger.estimatedCommittedTokens}`,
    `Pending: ${ledger.estimatedPendingTokens}`,
    `Remaining: ${ledger.estimatedRemainingTokens}`,
    `Turns: ${ledger.turns.length}`,
  ].join('\n');
}

export function renderTaskQueue(snapshot: PeerRuntimeSnapshot): string {
  if (!snapshot.activeTask && snapshot.queuedTasks.length === 0) {
    return 'No active or queued tasks for this chat.';
  }

  const lines = ['Task queue'];

  if (snapshot.activeTask) {
    lines.push(renderTaskLine(snapshot.activeTask, 'Running'));
  }

  snapshot.queuedTasks.forEach((task, index) => {
    lines.push(renderTaskLine(task, `Queued ${index + 1}`));
  });

  return lines.join('\n\n');
}

export function renderHealth(snapshot: GatewayHealthSnapshot): string {
  const lines = [
    'Bridge health',
    `Process: running (pid ${snapshot.bridgeProcessId})`,
    snapshot.serviceRunning
      ? `Service: running${snapshot.servicePid ? ` (pid ${snapshot.servicePid})` : ''}`
      : 'Service: not running',
    `WeChat account: ${snapshot.accountId}`,
    snapshot.codexExecutablePath
      ? `Codex executable: ${snapshot.codexExecutablePath}`
      : `Codex executable: unavailable${snapshot.codexExecutableError ? ` (${snapshot.codexExecutableError})` : ''}`,
    `Active contacts: ${snapshot.activePeerCount}`,
    `Queued tasks: ${snapshot.totalQueuedTasks}`,
  ];

  if (snapshot.serviceStartedAt) {
    lines.push(`Service started: ${snapshot.serviceStartedAt}`);
  }

  if (snapshot.lastRuntimeError) {
    lines.push(`Last runtime error: ${snapshot.lastRuntimeError}`);
  }

  return lines.join('\n');
}
