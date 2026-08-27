import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { analyzeMealPhoto, getMealPhotoAnalysisCapability } from './food-catalog';
import {
  classifyMealPhotoAnalysisError,
  parseMealPhotoAnalysisData,
  type ParsedMealPhotoAnalysis,
} from './meal-photo-api';
import type { FoodCatalogItem } from './types';
import {
  removeMealPhotoPayload,
  resolveMealPhotoPayload,
  storeMealPhotoPayload,
} from './meal-photo-payload';
import { announceQueuedLocalWrite } from './write-sync-signal';
import {
  canRetryMealPhoto,
  MAX_MEAL_PHOTO_ATTEMPTS,
  nextMealPhotoAttemptAt,
} from './meal-photo-queue-policy';

const PROCESSING_STALE_MS = 5 * 60_000;

export type MealPhotoQueueSummary = {
  pendingCount: number;
  readyCount: number;
  actionRequiredCount: number;
  latestReadyId: string | null;
  latestFailedId: string | null;
  latestFailureMessage: string | null;
};

export type QueuedMealPhotoResult = {
  id: string;
  description: string;
  requestId: string;
  items: FoodCatalogItem[];
  disclaimer: string;
};

type JobRow = {
  id: string;
  image_base64: string;
  media_type: string;
  source_label: string;
  description: string;
  attempt_count: number;
};

export async function queueMealPhotoAnalysis(
  db: SQLiteDatabase,
  input: { base64: string; mediaType: string; sourceLabel: string; description: string },
): Promise<string> {
  const base64 = input.base64.trim();
  if (base64.length < 100 || base64.length > 14_000_000) {
    throw new Error('The prepared meal photo is not a supported size. Choose it again.');
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.mediaType)) {
    throw new Error('Use a JPEG, PNG, or WebP meal photo.');
  }
  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  const payloadReference = await storeMealPhotoPayload(id, base64);
  try {
    await db.runAsync(
      `INSERT INTO meal_photo_jobs (
        id, image_base64, media_type, source_label, description, status,
        attempt_count, retryable, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', 0, 1, ?, ?)`,
      [
        id,
        payloadReference,
        input.mediaType,
        input.sourceLabel.trim().slice(0, 80) || 'Meal photo',
        input.description.trim().slice(0, 500),
        now,
        now,
      ],
    );
  } catch (cause) {
    await removeMealPhotoPayload(payloadReference).catch(() => undefined);
    throw cause;
  }
  announceQueuedLocalWrite();
  return id;
}

export async function getMealPhotoQueueSummary(db: SQLiteDatabase): Promise<MealPhotoQueueSummary> {
  const counts = await db.getFirstAsync<{
    pending_count: number;
    ready_count: number;
    action_required_count: number;
  }>(
    `SELECT
      SUM(CASE WHEN status IN ('pending', 'processing') OR (status = 'failed' AND retryable = 1) THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS ready_count,
      SUM(CASE WHEN status = 'failed' AND retryable = 0 THEN 1 ELSE 0 END) AS action_required_count
     FROM meal_photo_jobs`,
  );
  const ready = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM meal_photo_jobs WHERE status = 'completed'
     ORDER BY completed_at DESC, created_at DESC LIMIT 1`,
  );
  const failed = await db.getFirstAsync<{ id: string; error_message: string | null }>(
    `SELECT id, error_message FROM meal_photo_jobs
     WHERE status = 'failed' AND retryable = 0
     ORDER BY updated_at DESC LIMIT 1`,
  );
  return {
    pendingCount: Number(counts?.pending_count ?? 0),
    readyCount: Number(counts?.ready_count ?? 0),
    actionRequiredCount: Number(counts?.action_required_count ?? 0),
    latestReadyId: ready?.id ?? null,
    latestFailedId: failed?.id ?? null,
    latestFailureMessage: failed?.error_message ?? null,
  };
}

export async function externalizeLegacyMealPhotoPayloads(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ id: string; image_base64: string }>(
    `SELECT id, image_base64 FROM meal_photo_jobs
     WHERE length(image_base64) > 100 AND status IN ('pending', 'processing', 'failed')
     ORDER BY created_at ASC`,
  );
  const replacements: Array<{ id: string; previous: string; reference: string }> = [];
  for (const row of rows) {
    const reference = await storeMealPhotoPayload(row.id, row.image_base64);
    if (reference === row.image_base64) continue;
    replacements.push({ id: row.id, previous: row.image_base64, reference });
  }
  if (replacements.length === 0) return 0;
  const replace = async (database: SQLiteDatabase) => {
    for (const row of replacements) {
      await database.runAsync(
        `UPDATE meal_photo_jobs SET image_base64 = ?, updated_at = ? WHERE id = ? AND image_base64 = ?`,
        [row.reference, new Date().toISOString(), row.id, row.previous],
      );
    }
  };
  const deferred = db as SQLiteDatabase & {
    withDeferredPersistenceAsync?: <T>(task: (database: SQLiteDatabase) => Promise<T>) => Promise<T>;
  };
  if (deferred.withDeferredPersistenceAsync) {
    await deferred.withDeferredPersistenceAsync(replace);
  } else {
    await replace(db);
  }
  return replacements.length;
}

export async function getQueuedMealPhotoResult(
  db: SQLiteDatabase,
  jobId: string,
): Promise<QueuedMealPhotoResult | null> {
  const row = await db.getFirstAsync<{
    id: string;
    description: string;
    request_id: string | null;
    result_json: string | null;
  }>(
    `SELECT id, description, request_id, result_json
     FROM meal_photo_jobs WHERE id = ? AND status = 'completed'`,
    [jobId],
  );
  if (!row?.result_json || !row.request_id) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.result_json);
  } catch {
    return null;
  }
  const analysis = parseMealPhotoAnalysisData(parsed);
  return {
    id: row.id,
    description: row.description,
    requestId: row.request_id,
    ...analysis,
  };
}

export async function consumeQueuedMealPhotoResult(db: SQLiteDatabase, jobId: string): Promise<void> {
  await db.runAsync(`DELETE FROM meal_photo_jobs WHERE id = ? AND status = 'completed'`, [jobId]);
}

export async function retryQueuedMealPhotos(db: SQLiteDatabase): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE meal_photo_jobs
     SET status = 'pending', retryable = 1, attempt_count = 0,
         next_attempt_at = NULL, error_code = NULL, error_message = NULL, updated_at = ?
     WHERE status = 'failed'`,
    [now],
  );
  announceQueuedLocalWrite();
}

export async function discardQueuedMealPhoto(db: SQLiteDatabase, jobId: string): Promise<void> {
  const job = await db.getFirstAsync<{ image_base64: string }>(
    `SELECT image_base64 FROM meal_photo_jobs WHERE id = ?`,
    [jobId],
  );
  await db.runAsync(`DELETE FROM meal_photo_jobs WHERE id = ?`, [jobId]);
  if (job) await removeMealPhotoPayload(job.image_base64).catch(() => undefined);
}

export async function processPendingMealPhotoJobs(
  db: SQLiteDatabase,
): Promise<{ processed: number; state: 'idle' | 'completed' | 'waiting' | 'action_required' }> {
  const now = new Date();
  await db.runAsync(
    `UPDATE meal_photo_jobs
     SET status = 'pending', updated_at = ?
     WHERE status = 'processing' AND updated_at < ?`,
    [now.toISOString(), new Date(now.getTime() - PROCESSING_STALE_MS).toISOString()],
  );
  const job = await db.getFirstAsync<JobRow>(
    `SELECT id, image_base64, media_type, source_label, description, attempt_count
     FROM meal_photo_jobs
     WHERE status = 'pending'
        OR (status = 'failed' AND retryable = 1 AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
     ORDER BY created_at ASC LIMIT 1`,
    [now.toISOString()],
  );
  if (!job) return { processed: 0, state: 'idle' };

  const claimed = await db.runAsync(
    `UPDATE meal_photo_jobs SET status = 'processing', updated_at = ?
     WHERE id = ? AND status IN ('pending', 'failed')`,
    [now.toISOString(), job.id],
  );
  if (claimed.changes !== 1) return { processed: 0, state: 'idle' };

  let imageBase64: string | null;
  try {
    imageBase64 = await resolveMealPhotoPayload(job.image_base64);
  } catch {
    await storeFailure(db, job, {
      code: 'PHOTO_PAYLOAD_STORAGE_UNAVAILABLE',
      message: 'The retained photo could not be opened on this device. Reopen the app and retry.',
      retryable: true,
      requestId: null,
    });
    return { processed: 0, state: 'waiting' };
  }
  if (!imageBase64) {
    await storeFailure(db, job, {
      code: 'PHOTO_PAYLOAD_MISSING',
      message: 'The retained photo is no longer available. Choose the photo again.',
      retryable: false,
      requestId: null,
    });
    return { processed: 0, state: 'action_required' };
  }

  const capability = await getMealPhotoAnalysisCapability();
  if (!capability.available) {
    await storeFailure(db, job, {
      code: capability.status.toUpperCase(),
      message: capability.message,
      retryable: capability.retryable,
      requestId: capability.requestId,
    });
    return { processed: 0, state: capability.retryable ? 'waiting' : 'action_required' };
  }

  try {
    const analysis = await analyzeMealPhoto(imageBase64, job.description, job.media_type);
    await storeSuccess(db, job.id, analysis, new Date().toISOString());
    await removeMealPhotoPayload(job.image_base64).catch(() => undefined);
    return { processed: 1, state: 'completed' };
  } catch (cause) {
    const failure = classifyMealPhotoAnalysisError(cause);
    await storeFailure(db, job, failure);
    return { processed: 0, state: failure.retryable ? 'waiting' : 'action_required' };
  }
}

async function storeSuccess(
  db: SQLiteDatabase,
  jobId: string,
  analysis: ParsedMealPhotoAnalysis & { requestId: string },
  now: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE meal_photo_jobs
     SET image_base64 = '', status = 'completed', retryable = 0,
         next_attempt_at = NULL, error_code = NULL, error_message = NULL,
         request_id = ?, result_json = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      analysis.requestId,
      JSON.stringify({ items: analysis.items, disclaimer: analysis.disclaimer }),
      now,
      now,
      jobId,
    ],
  );
}

async function storeFailure(
  db: SQLiteDatabase,
  job: JobRow,
  failure: { code: string; message: string; retryable: boolean; requestId: string | null },
): Promise<void> {
  const attemptCount = job.attempt_count + 1;
  const retryable = canRetryMealPhoto(failure.retryable, attemptCount);
  const now = new Date().toISOString();
  const message = retryable
    ? failure.message
    : failure.retryable
      ? `Photo analysis did not complete after ${MAX_MEAL_PHOTO_ATTEMPTS} attempts. Try it again when ready.`
      : failure.message;
  await db.runAsync(
    `UPDATE meal_photo_jobs
     SET status = 'failed', attempt_count = ?, retryable = ?, next_attempt_at = ?,
         error_code = ?, error_message = ?, request_id = ?, updated_at = ?
     WHERE id = ?`,
    [
      attemptCount,
      retryable ? 1 : 0,
      retryable ? nextMealPhotoAttemptAt(attemptCount) : null,
      failure.code.slice(0, 80),
      message.slice(0, 300),
      failure.requestId,
      now,
      job.id,
    ],
  );
}
