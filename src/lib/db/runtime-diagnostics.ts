import type { SQLiteDatabase } from 'expo-sqlite';

import {
  classifyRuntimeDiagnostic,
  isRuntimeDiagnosticCode,
  type RuntimeDiagnosticCode,
} from './runtime-diagnostic-code';
import { getSetting, setSetting } from './settings';

export const RUNTIME_DIAGNOSTICS_KEY = 'runtime_diagnostics_v1';

export { classifyRuntimeDiagnostic } from './runtime-diagnostic-code';
export type { RuntimeDiagnosticCode } from './runtime-diagnostic-code';

export type RuntimeDiagnostics = {
  schemaVersion: 1;
  totalCount: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  lastCode: RuntimeDiagnosticCode;
};

export function buildRuntimeDiagnostics(
  previous: RuntimeDiagnostics | null,
  code: RuntimeDiagnosticCode,
  occurredAt = new Date().toISOString(),
): RuntimeDiagnostics {
  const timestamp = validTimestamp(occurredAt) ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    totalCount: (previous?.totalCount ?? 0) + 1,
    firstOccurredAt: previous?.firstOccurredAt ?? timestamp,
    lastOccurredAt: timestamp,
    lastCode: code,
  };
}

export function parseRuntimeDiagnostics(raw: string | null): RuntimeDiagnostics | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RuntimeDiagnostics>;
    const firstOccurredAt = validTimestamp(value.firstOccurredAt);
    const lastOccurredAt = validTimestamp(value.lastOccurredAt);
    if (
      value.schemaVersion !== 1
      || !Number.isInteger(value.totalCount)
      || (value.totalCount ?? 0) < 1
      || !firstOccurredAt
      || !lastOccurredAt
      || !isRuntimeDiagnosticCode(value.lastCode)
    ) return null;
    return {
      schemaVersion: 1,
      totalCount: value.totalCount!,
      firstOccurredAt,
      lastOccurredAt,
      lastCode: value.lastCode,
    };
  } catch {
    return null;
  }
}

export async function getRuntimeDiagnostics(db: SQLiteDatabase): Promise<RuntimeDiagnostics | null> {
  return parseRuntimeDiagnostics(await getSetting(db, RUNTIME_DIAGNOSTICS_KEY));
}

export async function recordRuntimeDiagnostic(
  db: SQLiteDatabase,
  cause: unknown,
  occurredAt = new Date().toISOString(),
): Promise<RuntimeDiagnostics> {
  const previous = await getRuntimeDiagnostics(db);
  const next = buildRuntimeDiagnostics(previous, classifyRuntimeDiagnostic(cause), occurredAt);
  await setSetting(db, RUNTIME_DIAGNOSTICS_KEY, JSON.stringify(next));
  return next;
}

export async function clearRuntimeDiagnostics(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM app_settings WHERE key = ?', [RUNTIME_DIAGNOSTICS_KEY]);
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
