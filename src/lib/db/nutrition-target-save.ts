import type { SQLiteDatabase } from 'expo-sqlite';

import { withExclusiveTransaction } from './exclusive-transaction.ts';
import type { NutritionTarget } from './types.ts';

type NutritionTargetInput = Omit<NutritionTarget, 'id' | 'effectiveFrom'>;

type NutritionTargetSaveOptions = {
  source?: 'manual' | 'adaptive';
  rationale?: string | null;
};

type NutritionTargetPayload = {
  id: string;
  effective_from: string;
  effective_to: string | null;
  calories_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  fat_g: number;
  fibre_g: number | null;
  desired_weekly_weight_change_percent: number;
  source: string;
  rationale: string | null;
  created_at: string;
  client_updated_at: string;
  deleted_at: string | null;
};

type NutritionTargetSaveDependencies = {
  createId: () => string;
  now: () => Date;
  toLocalDateKey: (date?: Date) => string;
  enqueueUpsert: (
    database: SQLiteDatabase,
    entityId: string,
    payload: NutritionTargetPayload,
  ) => Promise<void>;
};

type CurrentNutritionTargetRow = {
  id: string;
  effective_from: string;
  calories_kcal: number;
  protein_g: number;
  carbohydrate_g: number;
  fat_g: number;
  fibre_g: number | null;
  desired_weekly_weight_change_percent: number;
  source: string;
  rationale: string | null;
  created_at: string;
};

/**
 * Keeps the read/decide/write sequence for a versioned nutrition target atomic.
 * Dependencies are explicit so the public repository can supply its clock, UUID,
 * date-key and sync-queue implementations while tests remain deterministic.
 */
export function saveNutritionTargetAtomically(
  db: SQLiteDatabase,
  input: NutritionTargetInput,
  options: NutritionTargetSaveOptions,
  dependencies: NutritionTargetSaveDependencies,
): Promise<NutritionTarget> {
  return withExclusiveTransaction(db, async (db) => {
    const instant = dependencies.now();
    const now = instant.toISOString();
    const effectiveFrom = dependencies.toLocalDateKey(instant);
    const current = await db.getFirstAsync<CurrentNutritionTargetRow>(
      `SELECT id, effective_from, calories_kcal, protein_g, carbohydrate_g, fat_g,
        fibre_g, desired_weekly_weight_change_percent, source, rationale, created_at
       FROM nutrition_targets
       WHERE effective_to IS NULL AND deleted_at IS NULL
       ORDER BY effective_from DESC LIMIT 1`,
    );
    const updateCurrentDay = current?.effective_from === effectiveFrom;
    const id = updateCurrentDay && current ? current.id : dependencies.createId();
    const source = options.source ?? 'manual';
    const rationale = options.rationale?.trim() || null;
    const payload: NutritionTargetPayload = {
      id,
      effective_from: effectiveFrom,
      effective_to: null,
      calories_kcal: input.caloriesKcal,
      protein_g: input.proteinG,
      carbohydrate_g: input.carbohydrateG,
      fat_g: input.fatG,
      fibre_g: input.fibreG,
      desired_weekly_weight_change_percent: input.desiredWeeklyWeightChangePercent,
      source,
      rationale,
      created_at: updateCurrentDay && current ? current.created_at : now,
      client_updated_at: now,
      deleted_at: null,
    };

    if (updateCurrentDay) {
      await db.runAsync(
        `UPDATE nutrition_targets SET
          calories_kcal = ?, protein_g = ?, carbohydrate_g = ?, fat_g = ?, fibre_g = ?,
          desired_weekly_weight_change_percent = ?, source = ?, rationale = ?,
          updated_at = ?, client_updated_at = ? WHERE id = ?`,
        [
          input.caloriesKcal,
          input.proteinG,
          input.carbohydrateG,
          input.fatG,
          input.fibreG,
          input.desiredWeeklyWeightChangePercent,
          source,
          rationale,
          now,
          now,
          id,
        ],
      );
    } else {
      if (current) {
        const closedOn = dependencies.toLocalDateKey(new Date(instant.getTime() - 86_400_000));
        await db.runAsync(
          `UPDATE nutrition_targets SET effective_to = ?, updated_at = ?, client_updated_at = ?
           WHERE id = ?`,
          [closedOn, now, now, current.id],
        );
        await dependencies.enqueueUpsert(db, current.id, {
          id: current.id,
          effective_from: current.effective_from,
          effective_to: closedOn,
          calories_kcal: current.calories_kcal,
          protein_g: current.protein_g,
          carbohydrate_g: current.carbohydrate_g,
          fat_g: current.fat_g,
          fibre_g: current.fibre_g,
          desired_weekly_weight_change_percent: current.desired_weekly_weight_change_percent,
          source: current.source,
          rationale: current.rationale,
          created_at: current.created_at,
          client_updated_at: now,
          deleted_at: null,
        });
      }
      await db.runAsync(
        `INSERT INTO nutrition_targets (
          id, effective_from, calories_kcal, protein_g, carbohydrate_g, fat_g, fibre_g,
          desired_weekly_weight_change_percent, source, rationale, created_at, updated_at, client_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          effectiveFrom,
          input.caloriesKcal,
          input.proteinG,
          input.carbohydrateG,
          input.fatG,
          input.fibreG,
          input.desiredWeeklyWeightChangePercent,
          source,
          rationale,
          now,
          now,
          now,
        ],
      );
    }
    await dependencies.enqueueUpsert(db, id, payload);
    return { id, effectiveFrom, ...input };
  });
}
