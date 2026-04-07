const MAX_MESSAGE_LENGTH = 2048;
const FRESH_SESSION_MEMORY_BOOTSTRAP_MARKER = '[wechat-codex:fresh-session-memory-bootstrap]';
const FRESH_SESSION_MEMORY_BOOTSTRAP_PROMPT = [
  FRESH_SESSION_MEMORY_BOOTSTRAP_MARKER,
  'Fresh session bootstrap:',
  '- Before answering the user, first read AGENTS.md.',
  '- Then strictly follow the startup read order defined in AGENTS.md to load the local memory and persona files.',
  '- Apply what you read to align with the user, assistant persona, and current project context before responding.',
  '- After that, continue with the latest WeChat request normally.',
].join('\n');

export function buildPrompt(userText: string, hasImage: boolean): string {
  if (userText.trim()) {
    return userText;
  }

  if (hasImage) {
    return 'Please analyze the attached image.';
  }

  return 'Please respond to the latest WeChat message.';
}

export function buildFreshSessionSystemPrompt(systemPrompt?: string): string {
  if (systemPrompt?.includes(FRESH_SESSION_MEMORY_BOOTSTRAP_MARKER)) {
    return systemPrompt;
  }

  if (!systemPrompt) {
    return FRESH_SESSION_MEMORY_BOOTSTRAP_PROMPT;
  }

  return `${systemPrompt}\n\n${FRESH_SESSION_MEMORY_BOOTSTRAP_PROMPT}`;
}

export function buildTaskPreview(userText: string, hasImage: boolean): string {
  const trimmed = userText.replace(/\s+/g, ' ').trim();

  if (!trimmed && hasImage) {
    return '[Image attachment]';
  }

  if (trimmed && hasImage) {
    return `${trimmed} [image]`;
  }

  return trimmed || '[Message]';
}

export function splitMessage(text: string, maxLength: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex < maxLength * 0.3) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n+/, '');
  }

  return chunks;
}
