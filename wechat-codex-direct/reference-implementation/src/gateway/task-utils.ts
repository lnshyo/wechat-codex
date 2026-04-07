const MAX_MESSAGE_LENGTH = 2048;

export function buildPrompt(userText: string, hasImage: boolean): string {
  if (userText.trim()) {
    return userText;
  }

  if (hasImage) {
    return 'Please analyze the attached image.';
  }

  return 'Please respond to the latest WeChat message.';
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
