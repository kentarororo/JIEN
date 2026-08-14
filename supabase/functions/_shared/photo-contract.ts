export type NormalizedPhotoItem = {
  name: string;
  quantity: number;
  unit: string;
  caloriesKcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG: number | null;
  confidence: number;
};

export function parseProviderPhotoItems(text: string): NormalizedPhotoItem[] {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let payload: unknown;
  try {
    payload = JSON.parse(clean);
  } catch {
    throw new Error('PROVIDER_OUTPUT_INVALID');
  }
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.items) || record.items.length < 1 || record.items.length > 12) {
    throw new Error(record && Array.isArray(record.items) && record.items.length === 0
      ? 'NO_FOOD_DETECTED'
      : 'PROVIDER_OUTPUT_INVALID');
  }
  return record.items.map((value) => normalizeItem(value));
}

function normalizeItem(value: unknown): NormalizedPhotoItem {
  const item = asRecord(value);
  if (!item) throw new Error('PROVIDER_OUTPUT_INVALID');
  const name = boundedString(item.name, 120);
  const unit = boundedString(item.unit, 40);
  const quantity = boundedNumber(item.quantity, 0, 100_000, false);
  const caloriesKcal = boundedNumber(item.caloriesKcal, 0, 100_000);
  const proteinG = boundedNumber(item.proteinG, 0, 100_000);
  const carbohydrateG = boundedNumber(item.carbohydrateG, 0, 100_000);
  const fatG = boundedNumber(item.fatG, 0, 100_000);
  const fibreG = item.fibreG == null ? null : boundedNumber(item.fibreG, 0, 100_000);
  const confidence = boundedNumber(item.confidence, 0, 1);
  if (!name || !unit || quantity == null || caloriesKcal == null || proteinG == null
    || carbohydrateG == null || fatG == null || confidence == null
    || (item.fibreG != null && fibreG == null)) {
    throw new Error('PROVIDER_OUTPUT_INVALID');
  }
  return {
    name,
    quantity,
    unit,
    caloriesKcal,
    proteinG,
    carbohydrateG,
    fatG,
    fibreG,
    confidence,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= maximumLength ? clean : null;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  allowMinimum = true,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if ((allowMinimum ? value < minimum : value <= minimum) || value > maximum) return null;
  return value;
}
