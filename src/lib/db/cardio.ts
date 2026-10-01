import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { withExclusiveTransaction } from './exclusive-transaction';
import { enqueueUpsert } from './sync-queue';
import { toLocalDateKey } from '../time';
import { parseCardioMetadata, validateCardio, type CardioInput, type CardioSession } from '../training/cardio';

type Row = { id: string; logged_on: string; logged_at: string; notes: string | null; metadata: string;
  source: string; created_at: string; client_updated_at: string };
const columns = 'id, logged_on, logged_at, notes, metadata, source, created_at, client_updated_at';
const map = (row: Row): CardioSession | null => {
  const data = parseCardioMetadata(row.metadata);
  return data ? { ...data, id: row.id, loggedOn: row.logged_on, loggedAt: row.logged_at, notes: row.notes ?? '' } : null;
};
export async function listCardioSessions(db: SQLiteDatabase, from: string, through: string): Promise<CardioSession[]> {
  const rows = await db.getAllAsync<Row>(`SELECT ${columns} FROM wellness_logs
    WHERE kind = 'cardio' AND deleted_at IS NULL AND logged_on BETWEEN ? AND ? ORDER BY logged_at DESC, id DESC`, [from, through]);
  return rows.map(map).filter((row): row is CardioSession => row != null);
}
export async function getCardioSession(db: SQLiteDatabase, id: string): Promise<CardioSession | null> {
  const row = await db.getFirstAsync<Row>(`SELECT ${columns} FROM wellness_logs WHERE id = ? AND kind = 'cardio' AND deleted_at IS NULL`, [id]);
  return row ? map(row) : null;
}
function payload(row: Row, metadata: CardioInput, now: string, deletedAt: string | null = null) {
  return { id: row.id, kind: 'cardio', logged_on: row.logged_on, logged_at: row.logged_at, source: row.source,
    mood_score: null, energy_score: null, stress_score: null, soreness_score: null, motivation_score: null,
    sleep_duration_minutes: null, sleep_quality_score: null, body_weight_kg: null, injury_flags: [], notes: row.notes,
    metadata: { version: 1, ...metadata }, created_at: row.created_at, client_updated_at: now, deleted_at: deletedAt };
}
export async function saveCardioSession(db: SQLiteDatabase, input: CardioInput & { notes?: string }, loggedAt: string, id?: string): Promise<string> {
  const normalized = validateCardio(input);
  const timestamp = new Date(loggedAt);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() > Date.now() + 60_000) throw new Error('Log cardio for today or an earlier time.');
  if ((input.notes?.length ?? 0) > 1000) throw new Error('Keep notes within 1,000 characters.');
  return withExclusiveTransaction(db, async (tx) => {
    const existing = id ? await tx.getFirstAsync<Row>(`SELECT ${columns} FROM wellness_logs WHERE id = ? AND kind = 'cardio' AND deleted_at IS NULL`, [id]) : null;
    if (id && !existing) throw new Error('This cardio entry is no longer available.');
    if (existing && (existing.source !== 'manual' || !parseCardioMetadata(existing.metadata))) throw new Error('This cardio entry cannot be edited by this version.');
    const now = new Date(Math.max(Date.now(), Date.parse(existing?.client_updated_at ?? '') + 1 || 0)).toISOString();
    const row: Row = { id: existing?.id ?? Crypto.randomUUID(), logged_on: toLocalDateKey(timestamp), logged_at: timestamp.toISOString(),
      source: 'manual', notes: input.notes?.trim() || null, metadata: JSON.stringify({ version: 1, ...normalized }), created_at: existing?.created_at ?? now, client_updated_at: now };
    if (existing) {
      await tx.runAsync(`UPDATE wellness_logs SET logged_on = ?, logged_at = ?, metadata = ?, notes = ?, updated_at = ?, client_updated_at = ? WHERE id = ? AND kind = 'cardio' AND deleted_at IS NULL`,
        [row.logged_on, row.logged_at, row.metadata, row.notes, now, now, row.id]);
    } else {
      await tx.runAsync(`INSERT INTO wellness_logs (id, kind, logged_on, logged_at, source, injury_flags, metadata, notes, created_at, updated_at, client_updated_at)
        VALUES (?, 'cardio', ?, ?, 'manual', '[]', ?, ?, ?, ?, ?)`, [row.id, row.logged_on, row.logged_at, row.metadata, row.notes, now, now, now]);
    }
    await enqueueUpsert(tx, 'wellness_logs', row.id, payload(row, normalized, now));
    return row.id;
  });
}
export async function deleteCardioSession(db: SQLiteDatabase, id: string): Promise<void> {
  await withExclusiveTransaction(db, async (tx) => {
    const row = await tx.getFirstAsync<Row>(`SELECT ${columns} FROM wellness_logs WHERE id = ? AND kind = 'cardio' AND deleted_at IS NULL`, [id]);
    if (!row) return;
    const metadata = parseCardioMetadata(row.metadata);
    if (row.source !== 'manual' || !metadata) throw new Error('This cardio entry cannot be removed by this version.');
    const now = new Date(Math.max(Date.now(), Date.parse(row.client_updated_at) + 1 || 0)).toISOString();
    await tx.runAsync('UPDATE wellness_logs SET deleted_at = ?, updated_at = ?, client_updated_at = ? WHERE id = ?', [now, now, now, id]);
    await enqueueUpsert(tx, 'wellness_logs', id, payload(row, metadata, now, now));
  });
}
