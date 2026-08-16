import type { FoodCatalogItem } from './types';

export type MealPhotoCapabilityStatus =
  | 'ready'
  | 'auth_required'
  | 'consent_required'
  | 'not_configured'
  | 'offline'
  | 'unavailable';

export type MealPhotoCapability = {
  available: boolean;
  status: MealPhotoCapabilityStatus;
  message: string;
  retryable: boolean;
  requestId: string | null;
  provider: 'gemini' | 'anthropic' | null;
  credentialSource?: 'personal' | 'app' | null;
  dailyLimit?: number | null;
};

export type MealPhotoAnalysisFailure = {
  code: string;
  message: string;
  retryable: boolean;
  status: Exclude<MealPhotoCapabilityStatus, 'ready'>;
  requestId: string | null;
  provider: null;
};

export type ParsedMealPhotoAnalysis = {
  items: FoodCatalogItem[];
  disclaimer: string;
};

export function parseMealPhotoAnalysisData(value: unknown): ParsedMealPhotoAnalysis {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.items) || record.items.length < 1 || record.items.length > 12) {
    throw new Error('The photo service returned invalid food items. Try a clearer photo.');
  }
  const items = record.items.map((item, index) => parseFoodItem(item, index));
  const disclaimer = typeof record.disclaimer === 'string' && record.disclaimer.trim()
    ? record.disclaimer.trim().slice(0, 240)
    : 'AI estimate—review every portion and macro before saving. Not medical advice.';
  return { items, disclaimer };
}

export function parseMealPhotoCapabilityData(value: unknown): {
  provider: 'gemini' | 'anthropic';
  credentialSource: 'personal' | 'app';
  dailyLimit: number;
} {
  const record = asRecord(value);
  if (!record || record.available !== true
    || (record.provider !== 'gemini' && record.provider !== 'anthropic')
    || (record.credentialSource !== 'personal' && record.credentialSource !== 'app')
    || typeof record.dailyLimit !== 'number' || !Number.isInteger(record.dailyLimit)
    || record.dailyLimit < 1 || record.dailyLimit > 1000) {
    throw new Error('Photo analysis availability could not be confirmed.');
  }
  return {
    provider: record.provider,
    credentialSource: record.credentialSource,
    dailyLimit: record.dailyLimit,
  };
}

export function classifyMealPhotoAnalysisError(cause: unknown): MealPhotoAnalysisFailure {
  const error = cause instanceof Error ? cause : null;
  const details = cause != null && typeof cause === 'object'
    ? cause as { code?: unknown; retryable?: unknown; requestId?: unknown }
    : null;
  const code = typeof details?.code === 'string' ? details.code : 'INVALID_ANALYSIS_RESPONSE';
  const requestId = typeof details?.requestId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(details.requestId)
    ? details.requestId
    : null;
  if (code === 'AUTH_REQUIRED') {
    return {
      code,
      status: 'auth_required',
      retryable: false,
      requestId,
      provider: null,
      message: 'Sign in from Account to analyze this photo. Your selected photo and context are retained.',
    };
  }
  if (code === 'AI_CONSENT_REQUIRED') {
    return {
      code,
      status: 'consent_required',
      retryable: false,
      requestId,
      provider: null,
      message: 'Review and allow contextual AI in your profile before sending this photo. The photo stays on this device until then.',
    };
  }
  if (code === 'PHOTO_AI_NOT_CONFIGURED') {
    return {
      code,
      status: 'not_configured',
      retryable: false,
      requestId,
      provider: null,
      message: 'No Gemini connection is enabled yet. Open AI connection to create and securely connect a personal free-tier key.',
    };
  }
  if (code === 'PROVIDER_CONFIGURATION_INVALID') {
    return {
      code,
      status: 'not_configured',
      retryable: false,
      requestId,
      provider: null,
      message: 'Gemini rejected the connected key. Open AI connection to verify or replace it.',
    };
  }
  if (code === 'HTTP_404') {
    return {
      code,
      status: 'not_configured',
      retryable: false,
      requestId,
      provider: null,
      message: 'The secure photo-analysis function is not deployed for this build yet. Your selected photo remains available here.',
    };
  }
  if (code === 'SERVICE_NOT_CONFIGURED' || code === 'NOT_CONFIGURED') {
    return {
      code,
      status: 'not_configured',
      retryable: false,
      requestId,
      provider: null,
      message: 'This build is missing its Supabase server connection. Manual food logging remains available.',
    };
  }
  if (code === 'NETWORK_REQUIRED' || code === 'REQUEST_TIMEOUT') {
    return {
      code,
      status: 'offline',
      retryable: true,
      requestId,
      provider: null,
      message: 'AI photo analysis needs a connection. Your photo and context are retained so you can retry.',
    };
  }
  return {
    code,
    status: 'unavailable',
    retryable: typeof details?.retryable === 'boolean' ? details.retryable : true,
    requestId,
    provider: null,
    message: error?.message.trim()
      ? error.message
      : 'The photo could not be analyzed. Your photo and context are retained.',
  };
}

function parseFoodItem(value: unknown, index: number): FoodCatalogItem {
  const record = asRecord(value);
  if (!record) throw invalidItem(index);
  const name = requiredString(record.name, 120);
  const servingUnit = requiredString(record.servingUnit, 40);
  const id = requiredString(record.id, 128);
  const servingQuantity = finiteNumber(record.servingQuantity, 0, 100_000, false);
  const caloriesKcal = finiteNumber(record.caloriesKcal, 0, 100_000);
  const proteinG = finiteNumber(record.proteinG, 0, 100_000);
  const carbohydrateG = finiteNumber(record.carbohydrateG, 0, 100_000);
  const fatG = finiteNumber(record.fatG, 0, 100_000);
  const fibreG = record.fibreG == null ? null : finiteNumber(record.fibreG, 0, 100_000);
  const confidence = finiteNumber(record.confidence, 0, 1);
  if (!name || !servingUnit || !id || servingQuantity == null || caloriesKcal == null
    || proteinG == null || carbohydrateG == null || fatG == null || confidence == null
    || (record.fibreG != null && fibreG == null) || record.source !== 'ai_photo') {
    throw invalidItem(index);
  }
  return {
    id,
    name,
    brand: null,
    servingQuantity,
    servingUnit,
    caloriesKcal,
    proteinG,
    carbohydrateG,
    fatG,
    fibreG,
    source: 'ai_photo',
    sourceRef: null,
    barcode: null,
    confidence,
  };
}

function invalidItem(index: number): Error {
  return new Error(`Photo analysis item ${index + 1} was invalid. Try the analysis again.`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean && clean.length <= maxLength ? clean : null;
}

function finiteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  allowMinimum = true,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if ((allowMinimum ? value < minimum : value <= minimum) || value > maximum) return null;
  return value;
}
