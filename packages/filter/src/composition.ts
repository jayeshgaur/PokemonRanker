// FilterNode: an AST that lets presets and the (future) UI compose Filters
// with AND / OR / NOT. The leaves wrap a flat `Filter` shorthand, which is
// itself an implicit AND across its non-empty fields.

import type { Pokemon } from "@pokemon-ranker/shared";
import { matches, type Filter } from "./index";

export type FilterNode =
  | { kind: "leaf"; filter: Filter }
  | { kind: "and"; children: FilterNode[] }
  | { kind: "or"; children: FilterNode[] }
  | { kind: "not"; child: FilterNode };

export function leaf(filter: Filter): FilterNode {
  return { kind: "leaf", filter };
}

export function and(...children: FilterNode[]): FilterNode {
  return { kind: "and", children };
}

export function or(...children: FilterNode[]): FilterNode {
  return { kind: "or", children };
}

export function not(child: FilterNode): FilterNode {
  return { kind: "not", child };
}

export function matchesNode(node: FilterNode, p: Pokemon): boolean {
  switch (node.kind) {
    case "leaf":
      return matches(node.filter, p);
    case "and":
      // Empty AND vacuously matches (identity for conjunction).
      return node.children.every((c) => matchesNode(c, p));
    case "or":
      // Empty OR matches nothing (identity for disjunction).
      return node.children.some((c) => matchesNode(c, p));
    case "not":
      return !matchesNode(node.child, p);
  }
}

// Convenience: applyNode accepts either a Filter shorthand or a FilterNode,
// so callers don't have to manually wrap leaves.
export function applyNode(
  spec: Filter | FilterNode,
  pool: readonly Pokemon[],
): Pokemon[] {
  const node = isFilterNode(spec) ? spec : leaf(spec);
  return pool.filter((p) => matchesNode(node, p));
}

export function eligibleCountNode(
  spec: Filter | FilterNode,
  pool: readonly Pokemon[],
): number {
  const node = isFilterNode(spec) ? spec : leaf(spec);
  let n = 0;
  for (const p of pool) if (matchesNode(node, p)) n++;
  return n;
}

export function isFilterNode(value: unknown): value is FilterNode {
  if (!value || typeof value !== "object") return false;
  const k = (value as { kind?: unknown }).kind;
  return k === "leaf" || k === "and" || k === "or" || k === "not";
}

export function isFilter(value: unknown): value is Filter {
  return !!value && typeof value === "object" && !isFilterNode(value);
}
