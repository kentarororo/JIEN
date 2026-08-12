// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData } = await supabase.auth.getUser(token);
    if (!userData.user) return json({ error: 'Sign in is required.' }, 401);
    const { data: profile } = await supabase.from('users').select('ai_data_consent').eq('id', userData.user.id).single();
    if (!profile?.ai_data_consent) return json({ error: 'AI data consent is required before photo analysis.' }, 403);

    const { imageBase64, mediaType, description } = await request.json();
    if (typeof imageBase64 !== 'string' || imageBase64.length < 100) return json({ error: 'A meal photo is required.' }, 400);
    if (imageBase64.length > 14_000_000) return json({ error: 'The photo is too large. Retake it at a lower resolution.' }, 413);
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const model = Deno.env.get('ANTHROPIC_MODEL');
    if (!apiKey || !model) return json({ error: 'AI photo analysis is not configured.' }, 503);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        temperature: 0,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: ['image/jpeg', 'image/png', 'image/webp'].includes(mediaType) ? mediaType : 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: `Estimate the visible meal as editable food line items. User description: ${String(description ?? '').slice(0, 500)}\nReturn JSON only: {"items":[{"name":string,"quantity":number,"unit":string,"caloriesKcal":number,"proteinG":number,"carbohydrateG":number,"fatG":number,"fibreG":number|null,"confidence":number}]}. Confidence must be 0..1. Use realistic portions; do not provide medical advice.` },
        ] }],
      }),
    });
    if (!response.ok) return json({ error: 'The AI service could not analyze this photo.' }, 502);
    const message = await response.json();
    const text = message.content?.find((part) => part.type === 'text')?.text ?? '';
    const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/, ''));
    const items = (parsed.items ?? []).slice(0, 12).map((item, index) => ({
      id: `ai-${crypto.randomUUID()}`,
      name: String(item.name ?? `Food ${index + 1}`),
      brand: null,
      servingQuantity: positive(item.quantity, 1),
      servingUnit: String(item.unit ?? 'serving'),
      caloriesKcal: nonNegative(item.caloriesKcal),
      proteinG: nonNegative(item.proteinG),
      carbohydrateG: nonNegative(item.carbohydrateG),
      fatG: nonNegative(item.fatG),
      fibreG: item.fibreG == null ? null : nonNegative(item.fibreG),
      source: 'ai_photo',
      sourceRef: null,
      barcode: null,
      confidence: Math.max(0, Math.min(1, Number(item.confidence ?? 0.5))),
    }));
    return json({ items, disclaimer: 'AI estimate—review portions and macros before saving. Not medical advice.' });
  } catch {
    return json({ error: 'The photo analysis response could not be read.' }, 502);
  }
});

function nonNegative(value) { return Math.max(0, Number(value) || 0); }
function positive(value, fallback) { const number = Number(value); return number > 0 ? number : fallback; }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
