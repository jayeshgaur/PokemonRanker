import { describe, expect, it } from "vitest";
import {
  DEFAULT_PICKER_OPTS,
  parsePickerOpts,
  pickerOptsToParams,
  type PickerOpts,
} from "../lib/url-state";

describe("parsePickerOpts", () => {
  it("returns defaults for an empty input", () => {
    expect(parsePickerOpts(new URLSearchParams())).toEqual(DEFAULT_PICKER_OPTS);
    expect(parsePickerOpts({})).toEqual(DEFAULT_PICKER_OPTS);
  });

  it("parses every valid algorithm", () => {
    expect(parsePickerOpts({ algo: "merge-sort" }).algo).toBe("merge-sort");
    expect(parsePickerOpts({ algo: "single-elim" }).algo).toBe("single-elim");
    expect(parsePickerOpts({ algo: "glicko-random" }).algo).toBe("glicko-random");
  });

  it("falls back to the default for an unknown algorithm", () => {
    expect(parsePickerOpts({ algo: "bogosort" }).algo).toBe(
      DEFAULT_PICKER_OPTS.algo,
    );
  });

  it("accepts every valid top-N value (1, 3, 5, 10) and rejects others", () => {
    for (const n of [1, 3, 5, 10]) {
      expect(parsePickerOpts({ top: String(n) }).topN).toBe(n);
    }
    expect(parsePickerOpts({ top: "7" }).topN).toBe(DEFAULT_PICKER_OPTS.topN);
    expect(parsePickerOpts({ top: "abc" }).topN).toBe(DEFAULT_PICKER_OPTS.topN);
  });

  it("recognizes mode=vibes and falls back otherwise", () => {
    expect(parsePickerOpts({ mode: "vibes" }).mode).toBe("vibes");
    expect(parsePickerOpts({ mode: "informed" }).mode).toBe("informed");
    expect(parsePickerOpts({ mode: "fancy" }).mode).toBe("informed");
  });

  it("works with a Next.js searchParams shape (string | string[] | undefined)", () => {
    expect(
      parsePickerOpts({
        algo: "single-elim",
        top: "10",
        mode: "vibes",
      }),
    ).toEqual<PickerOpts>({
      algo: "single-elim",
      topN: 10,
      mode: "vibes",
    });
  });

  it("works with URLSearchParams", () => {
    const p = new URLSearchParams("algo=glicko-random&top=3&mode=vibes");
    expect(parsePickerOpts(p)).toEqual({
      algo: "glicko-random",
      topN: 3,
      mode: "vibes",
    });
  });
});

describe("pickerOptsToParams", () => {
  it("emits nothing for default opts (D-5 round-trip parity)", () => {
    const params = pickerOptsToParams(DEFAULT_PICKER_OPTS, new URLSearchParams());
    expect(params.toString()).toBe("");
  });

  it("emits only non-default fields", () => {
    const params = pickerOptsToParams(
      { algo: "single-elim", topN: DEFAULT_PICKER_OPTS.topN, mode: DEFAULT_PICKER_OPTS.mode },
      new URLSearchParams(),
    );
    expect(params.get("algo")).toBe("single-elim");
    expect(params.has("top")).toBe(false);
    expect(params.has("mode")).toBe(false);
  });

  it("round-trips an arbitrary opts shape", () => {
    const opts: PickerOpts = { algo: "glicko-random", topN: 10, mode: "vibes" };
    const params = pickerOptsToParams(opts, new URLSearchParams());
    expect(parsePickerOpts(params)).toEqual(opts);
  });
});
