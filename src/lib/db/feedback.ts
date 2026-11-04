import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  MAX_FEEDBACK_SCREENSHOT_LENGTH,
  normalizeFeedbackMessage,
  type FeedbackContext,
  type FeedbackType,
} from '@/lib/feedback-context';

import { enqueueUpsert } from './sync-queue';

export async function queueFeedback(
  db: SQLiteDatabase,
  input: {
    type: FeedbackType;
    message: string;
    context: FeedbackContext;
    screenshotBase64?: string | null;
  },
): Promise<string> {
  const id = Crypto.randomUUID();
  const message = normalizeFeedbackMessage(input.message);
  const screenshot = input.screenshotBase64?.trim() || null;
  if (screenshot && screenshot.length > MAX_FEEDBACK_SCREENSHOT_LENGTH) {
    throw new Error('The screenshot is too large to send. Turn off the screenshot and try again.');
  }
  const now = new Date().toISOString();
  await enqueueUpsert(db, 'feedback', id, {
    id,
    type: input.type,
    message,
    context: {
      screen: input.context.screen,
      appVersion: input.context.appVersion,
      build: input.context.build,
      platform: input.context.platform,
      viewport: input.context.viewport,
      connection: input.context.connection,
    },
    screenshotBase64: screenshot,
    createdAt: now,
  });
  return id;
}
