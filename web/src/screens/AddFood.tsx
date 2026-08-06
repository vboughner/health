import { useState, useEffect } from 'react';
import { api } from '../api';
import type { Food, Pickable, SearchResults } from '../types';
import { isSaved } from '../types';
import { FoodRow } from '../components/FoodRow';
import { LogSheet } from '../components/LogSheet';
import { ManualFood } from '../components/ManualFood';

const MIN_QUERY = 2;

export function AddFood({ onLogged }: { onLogged: () => void }) {
  const [query, setQuery] = useState('');
  // Results carry the query they belong to, so a stale response for an older query
  // is simply not rendered rather than needing to be cleared.
  const [results, setResults] = useState<{ query: string; data: SearchResults } | null>(null);
  const [quick, setQuick] = useState<{ frequent: Food[]; recent: Food[] }>({
    frequent: [],
    recent: [],
  });
  const [quickVersion, setQuickVersion] = useState(0);
  const [picked, setPicked] = useState<Pickable | null>(null);
  const [manual, setManual] = useState(false);
  const [toast, setToast] = useState('');

  const trimmed = query.trim();
  const searchable = trimmed.length >= MIN_QUERY;
  const current = results?.query === trimmed ? results.data : null;
  const searching = searchable && current === null;

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.get<{ foods: Food[] }>('/foods/frequent'),
      api.get<{ foods: Food[] }>('/foods/recent'),
    ])
      .then(([frequent, recent]) => {
        if (!cancelled) setQuick({ frequent: frequent.foods, recent: recent.foods });
      })
      .catch((err) => {
        if (!cancelled) console.error(err);
      });

    return () => {
      cancelled = true;
    };
  }, [quickVersion]);

  // Debounced search. The cancelled flag keeps a slow earlier request from landing
  // after a newer one.
  useEffect(() => {
    if (trimmed.length < MIN_QUERY) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<SearchResults>(`/foods/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          if (!cancelled) setResults({ query: trimmed, data });
        })
        .catch((err) => {
          if (!cancelled) console.error(err);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  function handleLogged(warning: string | null) {
    setPicked(null);
    setManual(false);
    setQuery('');
    setToast(warning ?? 'Logged');
    setTimeout(() => setToast(''), warning ? 6000 : 1800);
    setQuickVersion((v) => v + 1);
    onLogged();
  }

  return (
    <div className="stack">
      <input
        type="search"
        placeholder="Search foods…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
      />

      {toast && <div className={toast === 'Logged' ? 'toast' : 'toast toast-warn'}>{toast}</div>}

      {searchable ? (
        <SearchResultList results={current} searching={searching} onPick={setPicked} />
      ) : (
        <>
          <QuickList title="Eaten often" foods={quick.frequent} onPick={setPicked} />
          <QuickList title="Recent" foods={quick.recent} onPick={setPicked} />
          {quick.frequent.length === 0 && quick.recent.length === 0 && (
            <div className="empty">
              Search for a food to log it. After a few days your usual foods show up here for
              one-tap logging.
            </div>
          )}
        </>
      )}

      <button className="btn btn-block" onClick={() => setManual(true)}>
        Enter a food by hand
      </button>

      {picked && (
        <LogSheet
          food={picked}
          flags={isSaved(picked) ? picked.processed_flags : []}
          onClose={() => setPicked(null)}
          onLogged={handleLogged}
        />
      )}

      {manual && <ManualFood onClose={() => setManual(false)} onLogged={handleLogged} />}
    </div>
  );
}

function QuickList({
  title,
  foods,
  onPick,
}: {
  title: string;
  foods: Food[];
  onPick: (f: Food) => void;
}) {
  if (foods.length === 0) return null;

  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="list">
        {foods.map((f) => (
          <FoodRow key={f.id} food={f} flags={f.processed_flags} onPick={() => onPick(f)} />
        ))}
      </div>
    </div>
  );
}

function SearchResultList({
  results,
  searching,
  onPick,
}: {
  results: SearchResults | null;
  searching: boolean;
  onPick: (f: Pickable) => void;
}) {
  if (!results) {
    return searching ? (
      <div className="empty">
        <span className="spinner" />
      </div>
    ) : null;
  }

  const nothing = results.saved.length === 0 && results.usda.length === 0;

  return (
    <>
      {results.saved.length > 0 && (
        <div className="card">
          <div className="card-title">Your foods</div>
          <div className="list">
            {results.saved.map((f) => (
              <FoodRow key={f.id} food={f} flags={f.processed_flags} onPick={() => onPick(f)} />
            ))}
          </div>
        </div>
      )}

      {results.usda.length > 0 && (
        <div className="card">
          <div className="card-title">USDA database</div>
          <div className="list">
            {results.usda.map((f) => (
              <FoodRow key={f.source_id} food={f} onPick={() => onPick(f)} />
            ))}
          </div>
        </div>
      )}

      {!results.usdaConfigured && (
        <div className="note tiny">
          No USDA key configured, so this only searches foods you have already saved. Add
          USDA_API_KEY to .env to search the full database.
        </div>
      )}

      {results.usdaError && (
        <div className="note tiny">
          USDA lookup is unavailable right now ({results.usdaError}). Your saved foods still work.
        </div>
      )}

      {nothing && <div className="empty">No matches. Try a simpler word, or enter it by hand.</div>}
    </>
  );
}
