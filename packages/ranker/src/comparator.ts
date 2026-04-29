// Comparator interface (D-3 reserved hook). The user-facing UI is the default
// `Comparator` — the picker shows a duel and the user clicks. Phase 9 may
// drop in `LLMSuggestionComparator` (Anthropic-backed) for tiebreaking,
// commentary, or full agent-driven runs *without rewriting any ranker code*.
//
// The Comparator never overrides a user vote (D-3 invariant). When both a
// user and a Comparator are present, the user always wins; the Comparator's
// role is to *propose* on the user's behalf, not to *decide* against them.
// That invariant is property-tested in Phase 9; for Phase 3 we ship the
// interface and a passthrough runner.

import type { Decision, Duel, Ranker, Ranking } from "./types";

export interface Comparator {
  pick(duel: Duel): Promise<Decision> | Decision;
}

// Convenience runner: drives a Ranker to completion using a Comparator.
// Used by tests, CLI tools, and (eventually) the agent. The picker UI
// drives the ranker manually via nextDuel/submit because each duel waits
// on a real human click.
export async function runRanker(
  ranker: Ranker,
  comparator: Comparator,
): Promise<Ranking | null> {
  while (!ranker.isDone()) {
    const duel = ranker.nextDuel();
    if (!duel) break;
    const decision = await comparator.pick(duel);
    ranker.submit(decision);
  }
  return ranker.result();
}
