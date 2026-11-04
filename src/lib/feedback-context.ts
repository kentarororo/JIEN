export type FeedbackType = 'bug' | 'idea' | 'confusing';

export type FeedbackContext = {
  screen: string;
  appVersion: string;
  build: string;
  platform: string;
  viewport: string;
  connection: 'online' | 'offline';
};

export const MAX_FEEDBACK_MESSAGE_LENGTH = 2_000;
export const MAX_FEEDBACK_SCREENSHOT_LENGTH = 2_000_000;

export function normalizeFeedbackMessage(value: string): string {
  const message = value.trim();
  if (!message) throw new Error('Describe the bug, idea, or confusing part first.');
  if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
    throw new Error(`Keep feedback to ${MAX_FEEDBACK_MESSAGE_LENGTH.toLocaleString()} characters or fewer.`);
  }
  return message;
}

export function feedbackContextLines(context: FeedbackContext): string[] {
  return [
    `Screen: ${context.screen}`,
    `App: ${context.appVersion} (${context.build})`,
    `Platform: ${context.platform}`,
    `Viewport: ${context.viewport}`,
    `Connection: ${context.connection}`,
  ];
}
