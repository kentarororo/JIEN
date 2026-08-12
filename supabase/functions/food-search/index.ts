// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { query } = await request.json();
    const clean = typeof query === 'string' ? query.trim() : '';
    if (clean.length < 2 || clean.length > 120) return json({ error: 'Enter 2–120 characters.' }, 400);
    const apiKey = Deno.env.get('USDA_FDC_API_KEY');
    if (!apiKey) return json({ error: 'USDA FoodData Central is not configured.' }, 503);

    const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: clean, pageSize: 12, dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'] }),
    });
    if (!response.ok) return json({ error: 'USDA FoodData Central did not respond.' }, 502);
    const data = await response.json();
    const items = (data.foods ?? []).map((food) => ({
      id: `usda-${food.fdcId}`,
      name: food.description,
      brand: food.brandOwner ?? food.brandName ?? null,
      servingQuantity: 100,
      servingUnit: 'g',
      caloriesKcal: nutrient(food, 1008),
      proteinG: nutrient(food, 1003),
      carbohydrateG: nutrient(food, 1005),
      fatG: nutrient(food, 1004),
      fibreG: nullableNutrient(food, 1079),
      source: 'usda_fdc',
      sourceRef: String(food.fdcId),
      barcode: food.gtinUpc ?? null,
      confidence: null,
    })).filter((item) => item.name && item.caloriesKcal >= 0);
    return json({ items, attribution: 'USDA FoodData Central' });
  } catch {
    return json({ error: 'Invalid food search request.' }, 400);
  }
});

function nutrient(food, id) {
  return Number(food.foodNutrients?.find((entry) => entry.nutrientId === id)?.value ?? 0);
}
function nullableNutrient(food, id) {
  const value = food.foodNutrients?.find((entry) => entry.nutrientId === id)?.value;
  return value == null ? null : Number(value);
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
