"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Pokemon } from "@pokemon-ranker/shared";
import { canonicalKey, type Filter } from "@pokemon-ranker/filter";
import {
  createRanker,
  GlickoRandomRanker,
  RANKER_INFO,
  restoreRanker,
  type Decision,
  type Ranker,
  type Ranking,
} from "@pokemon-ranker/ranker";
import DuelCard from "./DuelCard";
import ResultsList from "./ResultsList";
import type { DisplayMode } from "@/lib/url-state";
import type { RankerKind } from "@pokemon-ranker/ranker";

const STORAGE_PREFIX = "pokemon-ranker:run:";

interface Props {
  filter: Filter;
  candidates: Pokemon[];
  algo: RankerKind;
  topN: number;
  mode: DisplayMode;
  audioEnabled: boolean;
  presetSlug: string | null;
}

export default function Picker({
  filter,
  candidates,
  algo,
  topN,
  mode,
  audioEnabled,
  presetSlug,
}: Props) {
  const storageKey = useMemo(
    () =>
      `${STORAGE_PREFIX}${presetSlug ? `preset:${presetSlug}` : canonicalKey(filter)}:${algo}`,
    [filter, algo, presetSlug],
  );
  const [ranker, setRanker] = useState<Ranker | null>(null);
  const [, setTick] = useState(0);
  const [showRankingEarly, setShowRankingEarly] = useState(false);

  useEffect(() => {
    if (candidates.length === 0) {
      setRanker(null);
      return;
    }
    let next: Ranker | null = null;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) next = restoreRanker(saved, candidates);
    } catch {
      next = null;
    }
    if (!next) next = createRanker(algo, candidates);
    setRanker(next);
    setShowRankingEarly(false);
  }, [storageKey, candidates, algo]);

  const persist = useCallback(
    (r: Ranker) => {
      try {
        window.localStorage.setItem(storageKey, r.serialize());
      } catch {
        // localStorage full or disabled — not fatal for the in-memory run.
      }
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    if (candidates.length > 0) {
      const fresh = createRanker(algo, candidates);
      setRanker(fresh);
      persist(fresh);
      setShowRankingEarly(false);
      setTick((t) => t + 1);
    } else {
      setRanker(null);
    }
  }, [candidates, persist, storageKey, algo]);

  const pick = useCallback(
    (decision: Decision) => {
      if (!ranker || ranker.isDone()) return;
      ranker.submit(decision);
      persist(ranker);
      setTick((t) => t + 1);
    },
    [ranker, persist],
  );

  const stopEarly = useCallback(() => {
    if (!ranker) return;
    if (ranker instanceof GlickoRandomRanker) {
      ranker.stopEarly();
      persist(ranker);
      setShowRankingEarly(true);
      setTick((t) => t + 1);
    }
  }, [ranker, persist]);

  const keepGoing = useCallback(() => {
    if (!ranker) return;
    if (ranker instanceof GlickoRandomRanker) {
      const done = ranker.progress().done;
      ranker.setTargetComparisons(done + Math.max(5, candidates.length * 3));
      persist(ranker);
      setShowRankingEarly(false);
      setTick((t) => t + 1);
    }
  }, [ranker, candidates, persist]);

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-400">
        No Pokémon match this filter. Try a different preset on the left.
      </div>
    );
  }
  if (!ranker) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-500">
        Loading…
      </div>
    );
  }

  const algoLabel =
    RANKER_INFO.find((i) => i.kind === algo)?.name ?? algo;

  // Glicko early-stop: show current ranking with "Keep going" affordance.
  if (showRankingEarly && !ranker.isDone() && ranker.currentResult) {
    const ranking = ranker.currentResult();
    if (ranking) {
      return (
        <ResultsView
          ranking={ranking}
          topN={topN}
          mode={mode}
          algoLabel={algoLabel}
          comparisonsDone={ranker.progress().done}
          isFinal={false}
          onReset={reset}
          onKeepGoing={algo === "glicko-random" ? keepGoing : undefined}
          highVolume={candidates.length > 200}
        />
      );
    }
  }

  if (ranker.isDone()) {
    const ranking = ranker.result();
    if (ranking) {
      return (
        <ResultsView
          ranking={ranking}
          topN={topN}
          mode={mode}
          algoLabel={algoLabel}
          comparisonsDone={ranker.progress().done}
          isFinal={true}
          onReset={reset}
          onKeepGoing={algo === "glicko-random" ? keepGoing : undefined}
          highVolume={candidates.length > 200}
        />
      );
    }
  }

  const duel = ranker.nextDuel();
  if (!duel) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center text-neutral-500">
        Preparing next duel…
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {candidates.length > 200 && (
        <HighVolumeBanner count={candidates.length} algo={algo} />
      )}
      <DuelCard
        left={duel.left}
        right={duel.right}
        progress={ranker.progress()}
        mode={mode}
        audioEnabled={audioEnabled}
        onPick={pick}
        onReset={reset}
        onStopEarly={algo === "glicko-random" ? stopEarly : undefined}
      />
    </div>
  );
}

function ResultsView(props: {
  ranking: Ranking;
  topN: number;
  mode: DisplayMode;
  algoLabel: string;
  comparisonsDone: number;
  isFinal: boolean;
  onReset: () => void;
  onKeepGoing?: () => void;
  highVolume: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {props.highVolume && (
        <p className="rounded-md bg-emerald-900/30 px-3 py-2 text-xs text-emerald-200">
          Big run! You compared {props.comparisonsDone} pairs.
        </p>
      )}
      <ResultsList {...props} />
    </div>
  );
}

function HighVolumeBanner({ count, algo }: { count: number; algo: RankerKind }) {
  const message: Record<RankerKind, string> = {
    "merge-sort": `${count} candidates × full sort = a lot of clicks. Switch to "Anytime ratings (Glicko)" to stop whenever you're ready, or "Single elimination" for a fast crowning.`,
    "single-elim": `${count} candidates → ${count - 1} duels. Doable, but try Glicko if you'd rather stop early.`,
    "glicko-random": `${count} candidates — Glicko's a great fit. Stop whenever the top names settle.`,
  };
  return (
    <p className="rounded-md border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
      ⚠️ {message[algo]}
    </p>
  );
}
