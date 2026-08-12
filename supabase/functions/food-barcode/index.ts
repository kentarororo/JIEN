// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { barcode } = await request.json();
    const clean = typeof barcode === 'string' ? barcode.replace(/\D/g, '') : '';
    if (clean.length < 8 || clean.length > 14) return json({ error: 'That barcode is not valid.' }, 400);
    const response = await fetch(`https://world.openfoodfacts.org/api/v3/product/${clean}.json?fields=code,product_name,brands,nutriments`, {
      headers: { 'User-Agent': 'JIEN/0.1 (food lookup; contact configured by operator)' },
    });
    if (!response.ok) return json({ error: response.status === 404 ? 'No food matched that barcode.' : 'The barcode database did not respond.' }, response.status === 404 ? 404 : 502);
    const data = await response.json();
    const product = data.product;
    if (!product?.product_name) return json({ error: 'No named food matched that barcode.' }, 404);
    const macros = product.nutriments ?? {};
    return json({
      items: [{
        id: `off-${clean}`,
        name: product.product_name,
        brand: product.brands || null,
        servingQuantity: 100,
        servingUnit: 'g',
        caloriesKcal: number(macros['energy-kcal_100g']),
        proteinG: number(macros.proteins_100g),
        carbohydrateG: number(macros.carbohydrates_100g),
        fatG: number(macros.fat_100g),
        fibreG: macros.fiber_100g == null ? null : number(macros.fiber_100g),
        source: 'open_food_facts',
        sourceRef: clean,
        barcode: clean,
        confidence: null,
      }],
      attribution: 'Open Food Facts contributors (ODbL)',
    });
  } catch {
    return json({ error: 'Invalid barcode request.' }, 400);
  }
});

function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
