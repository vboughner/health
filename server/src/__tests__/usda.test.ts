import { describe, it, expect, vi } from 'vitest';
import { parseSearchResponse, createUsdaClient, nullUsdaClient } from '../usda';

/** Shaped like a real FoodData Central search response. */
const FOUNDATION_BANANA = {
  fdcId: 1105314,
  description: 'Bananas, ripe and slightly ripe, raw',
  dataType: 'Foundation',
  foodNutrients: [
    { nutrientNumber: '203', nutrientName: 'Protein', unitName: 'G', value: 1.09 },
    { nutrientNumber: '204', nutrientName: 'Total lipid (fat)', unitName: 'G', value: 0.33 },
    { nutrientNumber: '205', nutrientName: 'Carbohydrate', unitName: 'G', value: 22.8 },
    { nutrientNumber: '208', nutrientName: 'Energy', unitName: 'KCAL', value: 89 },
    { nutrientNumber: '268', nutrientName: 'Energy', unitName: 'kJ', value: 372 },
    { nutrientNumber: '307', nutrientName: 'Sodium, Na', unitName: 'MG', value: 1 },
  ],
};

const BRANDED_COOKIE = {
  fdcId: 2001,
  description: 'CHOCOLATE CHIP COOKIES',
  dataType: 'Branded',
  brandName: 'Sample Bakery',
  brandOwner: 'Sample Foods Inc',
  householdServingFullText: '2 cookies',
  servingSize: 32,
  servingSizeUnit: 'g',
  ingredients: 'ENRICHED FLOUR, SUGAR, PARTIALLY HYDROGENATED SOYBEAN OIL, ARTIFICIAL FLAVOR',
  foodNutrients: [
    { nutrientNumber: '203', unitName: 'G', value: 5 },
    { nutrientNumber: '204', unitName: 'G', value: 25 },
    { nutrientNumber: '205', unitName: 'G', value: 65 },
    { nutrientNumber: '208', unitName: 'KCAL', value: 500 },
    { nutrientNumber: '307', unitName: 'MG', value: 420 },
    { nutrientNumber: '539', unitName: 'G', value: 35 },
  ],
};

describe('parseSearchResponse', () => {
  it('maps a Foundation food', () => {
    const [food] = parseSearchResponse({ foods: [FOUNDATION_BANANA] });

    expect(food).toEqual({
      source_id: '1105314',
      name: 'Bananas, ripe and slightly ripe, raw',
      brand: null,
      serving_desc: null,
      serving_grams: null,
      kcal_per_100g: 89,
      protein_g: 1.09,
      fat_g: 0.33,
      carb_g: 22.8,
      added_sugar_g: null,
      sodium_mg: 1,
      ingredients: null,
    });
  });

  it('takes calories in kcal, not the kilojoule figure under the same name', () => {
    const [food] = parseSearchResponse({ foods: [FOUNDATION_BANANA] });
    expect(food.kcal_per_100g).toBe(89);
  });

  it('maps a Branded food including serving size and ingredients', () => {
    const [food] = parseSearchResponse({ foods: [BRANDED_COOKIE] });

    expect(food).toMatchObject({
      source_id: '2001',
      brand: 'Sample Bakery',
      serving_desc: '2 cookies',
      serving_grams: 32,
      added_sugar_g: 35,
      sodium_mg: 420,
    });
    expect(food.ingredients).toContain('ENRICHED FLOUR');
  });

  it('un-shouts an all-caps branded description', () => {
    const [food] = parseSearchResponse({ foods: [BRANDED_COOKIE] });
    expect(food.name).toBe('Chocolate Chip Cookies');
  });

  it('leaves a normally-cased description alone', () => {
    const [food] = parseSearchResponse({ foods: [FOUNDATION_BANANA] });
    expect(food.name).toBe('Bananas, ripe and slightly ripe, raw');
  });

  it('falls back to brandOwner when brandName is missing', () => {
    const noBrandName = { ...BRANDED_COOKIE, brandName: undefined };
    const [food] = parseSearchResponse({ foods: [noBrandName] });
    expect(food.brand).toBe('Sample Foods Inc');
  });

  it('puts whole foods ahead of branded ones', () => {
    const results = parseSearchResponse({ foods: [BRANDED_COOKIE, FOUNDATION_BANANA] });
    expect(results.map((f) => f.source_id)).toEqual(['1105314', '2001']);
  });

  it('preserves USDA relevance order within a data type', () => {
    const a = { ...FOUNDATION_BANANA, fdcId: 1 };
    const b = { ...FOUNDATION_BANANA, fdcId: 2 };
    const results = parseSearchResponse({ foods: [a, b] });
    expect(results.map((f) => f.source_id)).toEqual(['1', '2']);
  });

  describe('defensive parsing', () => {
    it('drops a food with no calorie figure rather than logging it as zero', () => {
      const noEnergy = { ...FOUNDATION_BANANA, foodNutrients: [] };
      expect(parseSearchResponse({ foods: [noEnergy] })).toEqual([]);
    });

    it('keeps the good entries when one is malformed', () => {
      const results = parseSearchResponse({
        foods: [{ garbage: true }, FOUNDATION_BANANA, null, 'nonsense'],
      });
      expect(results).toHaveLength(1);
      expect(results[0].source_id).toBe('1105314');
    });

    it('defaults missing macros to zero but calories are still required', () => {
      const onlyEnergy = {
        fdcId: 9,
        description: 'Mystery',
        dataType: 'Branded',
        foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 200 }],
      };
      const [food] = parseSearchResponse({ foods: [onlyEnergy] });
      expect(food).toMatchObject({ kcal_per_100g: 200, protein_g: 0, fat_g: 0, carb_g: 0 });
    });

    it('ignores a serving size given in a unit that is not a weight', () => {
      const iu = { ...BRANDED_COOKIE, servingSize: 2, servingSizeUnit: 'IU' };
      const [food] = parseSearchResponse({ foods: [iu] });
      expect(food.serving_grams).toBeNull();
    });

    it('accepts millilitres as grams', () => {
      const drink = { ...BRANDED_COOKIE, servingSize: 240, servingSizeUnit: 'ml' };
      const [food] = parseSearchResponse({ foods: [drink] });
      expect(food.serving_grams).toBe(240);
    });

    it('ignores a zero or negative serving size', () => {
      const zero = { ...BRANDED_COOKIE, servingSize: 0 };
      expect(parseSearchResponse({ foods: [zero] })[0].serving_grams).toBeNull();
    });

    it('returns an empty array for an empty or unexpected response', () => {
      expect(parseSearchResponse({ foods: [] })).toEqual([]);
      expect(parseSearchResponse({})).toEqual([]);
      expect(parseSearchResponse(null)).toEqual([]);
      expect(parseSearchResponse('nope')).toEqual([]);
    });

    it('ignores a non-numeric nutrient value', () => {
      const bad = {
        ...FOUNDATION_BANANA,
        foodNutrients: [
          { nutrientNumber: '208', unitName: 'KCAL', value: 89 },
          { nutrientNumber: '203', unitName: 'G', value: 'lots' },
        ],
      };
      expect(parseSearchResponse({ foods: [bad] })[0].protein_g).toBe(0);
    });

    it('treats a blank ingredients string as absent', () => {
      const blank = { ...BRANDED_COOKIE, ingredients: '   ' };
      expect(parseSearchResponse({ foods: [blank] })[0].ingredients).toBeNull();
    });
  });
});

describe('createUsdaClient', () => {
  it('returns the null client when no key is configured', () => {
    const client = createUsdaClient('');

    expect(client.configured).toBe(false);
    expect(client).toBe(nullUsdaClient);
  });

  it('the null client returns no results instead of throwing', async () => {
    await expect(nullUsdaClient.search('banana')).resolves.toEqual([]);
  });

  it('sends the key and the query, and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ foods: [FOUNDATION_BANANA] }),
    });

    const client = createUsdaClient('test-key', fetchMock as unknown as typeof fetch);
    const results = await client.search('banana');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('api_key=test-key');
    expect(JSON.parse(init.body).query).toBe('banana');
    expect(results[0].name).toContain('Bananas');
  });

  it('asks for whole-food data types alongside branded', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ foods: [] }) });

    createUsdaClient('k', fetchMock as unknown as typeof fetch).search('rice');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).dataType).toEqual([
      'Foundation',
      'SR Legacy',
      'Branded',
    ]);
  });

  it('throws with the status when USDA rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    const client = createUsdaClient('bad-key', fetchMock as unknown as typeof fetch);

    await expect(client.search('banana')).rejects.toThrow(/403/);
  });
});
