// MergeSortComparator: bottom-up merge sort that pauses on every
// comparison. Worst-case ≈ n * ceil(log2(n)) duels. True total ranking.
//
// Tie semantics: `draw` ⇒ left first (stable, deterministic). `skip` ⇒
// deterministic side based on comparisonsDone parity (preserves
// resumability across serialize/deserialize). Both flagged for richer
// handling in Phase 3-expand.

import type { Pokemon } from "@pokemon-ranker/shared";
import type {
  Decision,
  Duel,
  Progress,
  Ranker,
  RankerKind,
  Ranking,
} from "./types";

interface MergeState {
  left: number[];
  right: number[];
  li: number;
  ri: number;
  output: number[];
}

interface MergeSortState {
  version: 1;
  // Accept either spelling — pre-Phase-3 saves used "mergesort".
  algo: "mergesort" | "merge-sort";
  ids: number[];
  runs: number[][];
  merge: MergeState | null;
  comparisonsDone: number;
  decisions: Decision[];
}

export class MergeSortComparator implements Ranker {
  readonly kind: RankerKind = "merge-sort";
  private state: MergeSortState;
  private byId: Map<number, Pokemon>;

  constructor(pool: readonly Pokemon[]) {
    const ids = pool.map((p) => p.id);
    this.state = {
      version: 1,
      algo: "merge-sort",
      ids,
      runs: ids.map((id) => [id]),
      merge: null,
      comparisonsDone: 0,
      decisions: [],
    };
    this.byId = new Map(pool.map((p) => [p.id, p]));
    this.advance();
  }

  static deserialize(
    serialized: string,
    pool: readonly Pokemon[],
  ): MergeSortComparator {
    const state = JSON.parse(serialized) as MergeSortState;
    if (state.version !== 1 || (state.algo !== "merge-sort" && state.algo !== "mergesort")) {
      throw new Error("incompatible serialized ranker state");
    }
    // Normalize the legacy "mergesort" spelling to the canonical hyphenated
    // form so a re-serialize() emits the modern label.
    if (state.algo === "mergesort") state.algo = "merge-sort";
    const byId = new Map(pool.map((p) => [p.id, p]));
    for (const id of state.ids) {
      if (!byId.has(id)) {
        throw new Error(`pool missing pokemon id=${id} from serialized state`);
      }
    }
    const inst = new MergeSortComparator([]);
    inst.state = state;
    inst.byId = byId;
    return inst;
  }

  serialize(): string {
    return JSON.stringify(this.state);
  }

  isDone(): boolean {
    return this.state.runs.length <= 1 && this.state.merge === null;
  }

  nextDuel(): Duel | null {
    if (this.isDone()) return null;
    const m = this.state.merge;
    if (!m) return null;
    const leftId = m.left[m.li];
    const rightId = m.right[m.ri];
    if (leftId === undefined || rightId === undefined) return null;
    const left = this.byId.get(leftId);
    const right = this.byId.get(rightId);
    if (!left || !right) {
      throw new Error("pool missing pokemon for current duel");
    }
    return { left, right };
  }

  submit(decision: Decision): void {
    const m = this.state.merge;
    if (!m) {
      throw new Error("submit called when no duel is active");
    }
    if (m.li >= m.left.length || m.ri >= m.right.length) {
      throw new Error("submit called when merge has no pending comparison");
    }
    const leftId = m.left[m.li]!;
    const rightId = m.right[m.ri]!;

    let leftFirst: boolean;
    switch (decision) {
      case "left_wins":
      case "draw":
        leftFirst = true;
        break;
      case "right_wins":
        leftFirst = false;
        break;
      case "skip":
        leftFirst = this.state.comparisonsDone % 2 === 0;
        break;
    }

    if (leftFirst) {
      m.output.push(leftId);
      m.li++;
    } else {
      m.output.push(rightId);
      m.ri++;
    }
    this.state.comparisonsDone++;
    this.state.decisions.push(decision);
    this.advance();
  }

  progress(): Progress {
    const n = this.state.ids.length;
    const total = n <= 1 ? 0 : n * Math.ceil(Math.log2(n));
    const done = this.state.comparisonsDone;
    const fraction = total === 0 ? 1 : Math.min(1, done / total);
    return { done, total, fraction };
  }

  result(): Ranking | null {
    if (!this.isDone()) return null;
    const sorted = this.state.runs[0] ?? this.state.ids;
    return {
      ordered: sorted.map((id, idx) => {
        const p = this.byId.get(id);
        if (!p) throw new Error(`missing pokemon id=${id}`);
        return { rank: idx + 1, pokemon: p };
      }),
    };
  }

  // Drain any exhausted merge, then set up the next merge if more runs remain.
  private advance(): void {
    while (true) {
      const m = this.state.merge;
      if (m) {
        const leftDone = m.li >= m.left.length;
        const rightDone = m.ri >= m.right.length;
        if (!leftDone && !rightDone) return;
        if (!leftDone) {
          for (let i = m.li; i < m.left.length; i++) m.output.push(m.left[i]!);
        }
        if (!rightDone) {
          for (let i = m.ri; i < m.right.length; i++) m.output.push(m.right[i]!);
        }
        this.state.runs.push(m.output);
        this.state.merge = null;
      }
      if (this.state.runs.length <= 1) return;
      const left = this.state.runs.shift()!;
      const right = this.state.runs.shift()!;
      this.state.merge = { left, right, li: 0, ri: 0, output: [] };
    }
  }
}
