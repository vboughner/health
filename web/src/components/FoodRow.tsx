import type { Pickable } from '../types';

export function WarningChip({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <span className="chip chip-warn" title={reasons.join(', ')}>
      ⚠
    </span>
  );
}

/** A tappable food in a search result or quick-pick list. */
export function FoodRow({
  food,
  flags = [],
  onPick,
}: {
  food: Pickable;
  flags?: string[];
  onPick: () => void;
}) {
  const detail = [food.brand, food.serving_desc].filter(Boolean).join(' · ');

  return (
    <button className="food-row" onClick={onPick}>
      <span className="food-row-main">
        <span className="food-row-name">
          {food.name}
          <WarningChip reasons={flags} />
        </span>
        {detail && <span className="food-row-detail">{detail}</span>}
      </span>
      <span className="food-row-kcal">
        {Math.round(food.kcal_per_100g)}
        <span className="food-row-unit">/100g</span>
      </span>
    </button>
  );
}
