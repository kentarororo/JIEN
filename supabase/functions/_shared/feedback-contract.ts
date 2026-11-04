export const FEEDBACK_TYPES = ['bug', 'idea', 'confusing'] as const;
export const MAX_FEEDBACK_MESSAGE_LENGTH = 2_000;
export const MAX_FEEDBACK_SCREENSHOT_LENGTH = 2_000_000;

type FeedbackType = typeof FEEDBACK_TYPES[number];

export type FeedbackRequest = {
  id: string;
  type: FeedbackType;
  message: string;
  context: {
    screen: string;
    appVersion: string;
    build: string;
    platform: string;
    viewport: string;
    connection: 'online' | 'offline';
  };
  screenshotBase64: string | null;
  createdAt: string;
};

export function parseFeedbackEnvelope(value: unknown): FeedbackRequest | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.data)) return null;
  const data = value.data;
  if (Object.keys(data).some((key) => !['id', 'type', 'message', 'context', 'screenshotBase64', 'createdAt'].includes(key))) return null;
  if (typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(data.id)) return null;
  if (typeof data.type !== 'string' || !FEEDBACK_TYPES.includes(data.type as FeedbackType)) return null;
  if (typeof data.message !== 'string' || data.message !== data.message.trim() || data.message.length < 1 || data.message.length > MAX_FEEDBACK_MESSAGE_LENGTH) return null;
  if (!isRecord(data.context) || Object.keys(data.context).sort().join(',') !== 'appVersion,build,connection,platform,screen,viewport') return null;
  const context = data.context;
  for (const key of ['screen', 'appVersion', 'build', 'platform', 'viewport'] as const) {
    if (typeof context[key] !== 'string' || context[key].length < 1 || context[key].length > 120) return null;
  }
  if (context.connection !== 'online' && context.connection !== 'offline') return null;
  if (data.screenshotBase64 !== null && (typeof data.screenshotBase64 !== 'string' || data.screenshotBase64.length < 100 || data.screenshotBase64.length > MAX_FEEDBACK_SCREENSHOT_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(data.screenshotBase64))) return null;
  if (typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) return null;
  return {
    id: data.id,
    type: data.type as FeedbackType,
    message: data.message,
    context: {
      screen: context.screen as string,
      appVersion: context.appVersion as string,
      build: context.build as string,
      platform: context.platform as string,
      viewport: context.viewport as string,
      connection: context.connection,
    },
    screenshotBase64: data.screenshotBase64 as string | null,
    createdAt: data.createdAt,
  };
}

export function feedbackIssueTitle(report: FeedbackRequest): string {
  const first = report.message.replace(/\s+/g, ' ').slice(0, 60);
  return `[Feedback] ${report.type}: ${first}`;
}

export function feedbackIssueBody(report: FeedbackRequest): string {
  const screenshot = report.screenshotBase64 ? 'Yes — retained privately in the feedback record.' : 'No';
  return [
    report.message,
    '',
    '### Device context',
    `- Screen: ${report.context.screen}`,
    `- App: ${report.context.appVersion} (${report.context.build})`,
    `- Platform: ${report.context.platform}`,
    `- Viewport: ${report.context.viewport}`,
    `- Connection: ${report.context.connection}`,
    `- Screenshot: ${screenshot}`,
    '',
    `Feedback ID: \`${report.id}\``,
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
