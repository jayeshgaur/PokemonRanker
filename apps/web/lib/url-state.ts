// Picker URL state encoding (D-5: URL is source of truth). Keeps the algo
// + top-N + display mode out of the Filter shape — those are presentation
// concerns, not eligibility concerns.

import type { RankerKind } from "@pokemon-ranker/ranker";

export type DisplayMode = "informed" | "vibes";

export interface PickerOpts {
  algo: RankerKind;
  topN: number;
  mode: DisplayMode;
}

export const DEFAULT_PICKER_OPTS: PickerOpts = {
  algo: "merge-sort",
  topN: 5,
  mode: "informed",
};

const VALID_ALGOS: ReadonlySet<RankerKind> = new Set([
  "merge-sort",
  "single-elim",
  "glicko-random",
]);

const VALID_TOP_N: ReadonlySet<number> = new Set([1, 3, 5, 10]);

export function parsePickerOpts(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): PickerOpts {
  const get = (key: string): string | undefined => {
    if (source instanceof URLSearchParams) return source.get(key) ?? undefined;
    const raw = source[key];
    if (raw === undefined) return undefined;
    return Array.isArray(raw) ? raw[0] : raw;
  };

  const algoRaw = get("algo");
  const algo = (
    algoRaw && VALID_ALGOS.has(algoRaw as RankerKind)
      ? algoRaw
      : DEFAULT_PICKER_OPTS.algo
  ) as RankerKind;

  const topRaw = get("top");
  const topParsed = topRaw ? Number.parseInt(topRaw, 10) : NaN;
  const topN = VALID_TOP_N.has(topParsed) ? topParsed : DEFAULT_PICKER_OPTS.topN;

  const modeRaw = get("mode");
  const mode: DisplayMode =
    modeRaw === "vibes" ? "vibes" : DEFAULT_PICKER_OPTS.mode;

  return { algo, topN, mode };
}

export function pickerOptsToParams(opts: PickerOpts, params: URLSearchParams): URLSearchParams {
  if (opts.algo !== DEFAULT_PICKER_OPTS.algo) params.set("algo", opts.algo);
  if (opts.topN !== DEFAULT_PICKER_OPTS.topN) params.set("top", String(opts.topN));
  if (opts.mode !== DEFAULT_PICKER_OPTS.mode) params.set("mode", opts.mode);
  return params;
}
