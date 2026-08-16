import { invokeEdgeFunctionEnvelope } from './supabase';
import { parseAiConnectionStatus, type AiConnectionStatus } from './ai-settings-contract';

export type { AiConnectionStatus } from './ai-settings-contract';

export async function getAiConnectionStatus(): Promise<AiConnectionStatus> {
  const response = await invokeEdgeFunctionEnvelope<unknown>('ai-settings', { action: 'status' }, 10_000);
  return { ...parseAiConnectionStatus(response.data), requestId: response.requestId };
}

export async function savePersonalGeminiKey(apiKey: string): Promise<AiConnectionStatus> {
  const clean = apiKey.trim();
  if (clean.length < 20 || clean.length > 512 || /\s/.test(clean)) {
    throw new Error('Paste the complete Gemini API key without spaces.');
  }
  const response = await invokeEdgeFunctionEnvelope<unknown>('ai-settings', {
    action: 'save',
    apiKey: clean,
    acknowledgesBillingControl: true,
    acknowledgesFreeTierDataUse: true,
  }, 15_000);
  return { ...parseAiConnectionStatus(response.data), requestId: response.requestId };
}

export async function removePersonalGeminiKey(): Promise<AiConnectionStatus> {
  const response = await invokeEdgeFunctionEnvelope<unknown>('ai-settings', { action: 'remove' }, 10_000);
  return { ...parseAiConnectionStatus(response.data), requestId: response.requestId };
}
