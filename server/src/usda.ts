/**
 * USDA FoodData Central client.
 *
 * Behind an interface so tests use a fake and never touch the network. Response
 * parsing is a separate pure function, which is where the real complexity lives.
 *
 * Free API key: https://fdc.nal.usda.gov/api-key-signup.html
 */

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

/**
 * Nutrient numbers as published by USDA. These are the stable identifiers —
 * nutrientName wording varies between data types.
 */
const NUTRIENT = {
  protein: '203',
  fat: '204',
  carb: '205',
  energyKcal: '208',
  sodium: '307',
  addedSugar: '539',
};

/**
 * Whole foods first. Foundation and SR Legacy are USDA's lab-analyzed entries for
 * raw ingredients, which is most of this diet; Branded is the packaged-goods
 * database, useful but secondary here.
 */
const DATA_TYPE_PRIORITY: Record<string, number> = {
  Foundation: 0,
  'SR Legacy': 1,
  'Survey (FNDDS)': 2,
  Branded: 3,
};

/** A food as it comes back from a search, before it's saved. All values per 100 g. */
export interface UsdaFood {
  source_id: string;
  name: string;
  brand: string | null;
  serving_desc: string | null;
  serving_grams: number | null;
  kcal_per_100g: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  added_sugar_g: number | null;
  sodium_mg: number | null;
  ingredients: string | null;
}

export interface UsdaClient {
  readonly configured: boolean;
  search(query: string, limit?: number): Promise<UsdaFood[]>;
}

/** Used when no API key is set. The app still works on saved and manual foods. */
export const nullUsdaClient: UsdaClient = {
  configured: false,
  async search() {
    return [];
  },
};

export function createUsdaClient(apiKey: string, fetchImpl: typeof fetch = fetch): UsdaClient {
  if (!apiKey) return nullUsdaClient;

  return {
    configured: true,

    async search(query: string, limit = 25): Promise<UsdaFood[]> {
      const url = new URL(SEARCH_URL);
      url.searchParams.set('api_key', apiKey);

      const res = await fetchImpl(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          dataType: ['Foundation', 'SR Legacy', 'Branded'],
          pageSize: limit,
          requireAllWords: true,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        throw new Error(`USDA search failed (${res.status})`);
      }

      return parseSearchResponse(await res.json());
    },
  };
}

/**
 * Turn a FoodData Central search response into our own shape.
 *
 * Pure and defensive: USDA responses are inconsistent between data types, and a
 * single malformed entry should not fail a whole search. Foods with no usable
 * calorie figure are dropped rather than logged as zero, since a silent zero
 * would quietly corrupt a day's total.
 */
export function parseSearchResponse(json: unknown): UsdaFood[] {
  const foods = (json as { foods?: unknown })?.foods;
  if (!Array.isArray(foods)) return [];

  const parsed: { food: UsdaFood; priority: number }[] = [];

  for (const raw of foods) {
    const food = parseFood(raw);
    if (food) {
      const dataType = String((raw as { dataType?: unknown }).dataType ?? '');
      parsed.push({ food, priority: DATA_TYPE_PRIORITY[dataType] ?? 99 });
    }
  }

  // Stable sort — within a data type, USDA's own relevance ordering is preserved.
  return parsed.sort((a, b) => a.priority - b.priority).map((p) => p.food);
}

function parseFood(raw: unknown): UsdaFood | null {
  if (!raw || typeof raw !== 'object') return null;

  const r = raw as Record<string, unknown>;
  const fdcId = r.fdcId;
  const description = r.description;

  if (fdcId === undefined || typeof description !== 'string' || !description) return null;

  const nutrients = nutrientMap(r.foodNutrients);
  const kcal = nutrients.get(NUTRIENT.energyKcal);

  // No calorie figure means we cannot log it honestly.
  if (kcal === undefined) return null;

  return {
    source_id: String(fdcId),
    name: titleCase(description),
    brand: str(r.brandName) ?? str(r.brandOwner),
    serving_desc: str(r.householdServingFullText),
    serving_grams: servingGrams(r),
    kcal_per_100g: kcal,
    protein_g: nutrients.get(NUTRIENT.protein) ?? 0,
    fat_g: nutrients.get(NUTRIENT.fat) ?? 0,
    carb_g: nutrients.get(NUTRIENT.carb) ?? 0,
    added_sugar_g: nutrients.get(NUTRIENT.addedSugar) ?? null,
    sodium_mg: nutrients.get(NUTRIENT.sodium) ?? null,
    ingredients: str(r.ingredients),
  };
}

/**
 * Index nutrients by USDA nutrient number.
 *
 * Energy appears twice on many foods — once in kcal and once in kJ — under the same
 * name but different nutrient numbers, so keying on the number rather than the name
 * avoids picking up a kilojoule figure and calling it calories.
 */
function nutrientMap(rawNutrients: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(rawNutrients)) return map;

  for (const item of rawNutrients) {
    if (!item || typeof item !== 'object') continue;

    const n = item as Record<string, unknown>;
    const number = String(n.nutrientNumber ?? '');
    const value = n.value;

    if (!number || typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (map.has(number)) continue; // first entry wins

    map.set(number, value);
  }

  return map;
}

function servingGrams(r: Record<string, unknown>): number | null {
  const size = r.servingSize;
  const unit = String(r.servingSizeUnit ?? '').toLowerCase();

  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null;

  // Grams and millilitres both come back on branded foods. Treating ml as grams is
  // wrong for oil and close enough for everything else; anything more exotic (IU,
  // for instance) is not a weight at all and gets dropped.
  if (unit === 'g' || unit === 'grm' || unit === 'ml' || unit === 'mlt') return size;

  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** USDA descriptions are SHOUTED for branded foods and sentence case elsewhere. */
function titleCase(value: string): string {
  if (value !== value.toUpperCase()) return value;

  return value
    .toLowerCase()
    .replace(
      /(^|[\s(/-])([a-z])/g,
      (_, prefix: string, letter: string) => prefix + letter.toUpperCase(),
    );
}
