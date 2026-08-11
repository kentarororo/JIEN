import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { listNutritionExportRows, listWorkoutExportRows } from '@/lib/db';

import { nutritionToCsv, workoutsToCsv } from './csv';

type ExportKind = 'workouts' | 'nutrition' | 'all';

function datedName(kind: ExportKind, extension: 'csv' | 'json'): string {
  return `jien-${kind}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

async function shareText(name: string, text: string, mimeType: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: `Export ${name}` });
}

export async function exportWorkoutsCsv(db: SQLiteDatabase): Promise<void> {
  const rows = await listWorkoutExportRows(db);
  await shareText(datedName('workouts', 'csv'), workoutsToCsv(rows), 'text/csv');
}

export async function exportNutritionCsv(db: SQLiteDatabase): Promise<void> {
  const rows = await listNutritionExportRows(db);
  await shareText(datedName('nutrition', 'csv'), nutritionToCsv(rows), 'text/csv');
}

export async function exportAllJson(db: SQLiteDatabase): Promise<void> {
  const [workouts, nutrition] = await Promise.all([
    listWorkoutExportRows(db),
    listNutritionExportRows(db),
  ]);
  await shareText(
    datedName('all', 'json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), workouts, nutrition }, null, 2),
    'application/json',
  );
}

export { nutritionToCsv, workoutsToCsv } from './csv';
