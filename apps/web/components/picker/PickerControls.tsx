"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { RANKER_INFO, type RankerKind } from "@pokemon-ranker/ranker";
import {
  DEFAULT_PICKER_OPTS,
  type DisplayMode,
  type PickerOpts,
} from "@/lib/url-state";

interface Props {
  opts: PickerOpts;
  candidateCount: number;
  audioEnabled: boolean;
  onToggleAudio: () => void;
}

const TOP_N_OPTIONS = [1, 3, 5, 10] as const;

export default function PickerControls({
  opts,
  candidateCount,
  audioEnabled,
  onToggleAudio,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(search.toString());
    if (value === null) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    const url = (qs ? `${pathname}?${qs}` : pathname) as Route;
    startTransition(() => router.push(url));
  }

  function setAlgo(k: RankerKind) {
    setParam("algo", k === DEFAULT_PICKER_OPTS.algo ? null : k);
  }
  function setTopN(n: number) {
    setParam("top", n === DEFAULT_PICKER_OPTS.topN ? null : String(n));
  }
  function setMode(m: DisplayMode) {
    setParam("mode", m === DEFAULT_PICKER_OPTS.mode ? null : m);
  }

  return (
    <section className="flex flex-wrap items-end gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <Field label="Algorithm" hint={RANKER_INFO.find((i) => i.kind === opts.algo)?.shortDescription}>
        <select
          value={opts.algo}
          onChange={(e) => setAlgo(e.target.value as RankerKind)}
          disabled={pending}
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200"
        >
          {RANKER_INFO.map((info) => (
            <option key={info.kind} value={info.kind}>
              {info.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-neutral-500">
          {RANKER_INFO.find((i) => i.kind === opts.algo)?.comparisonsHint(candidateCount)}
        </p>
      </Field>

      <Field label="Show top">
        <div className="flex gap-1">
          {TOP_N_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTopN(n)}
              className={
                opts.topN === n
                  ? "rounded border border-emerald-500 bg-emerald-600/20 px-2 py-1 text-xs text-emerald-100"
                  : "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
              }
            >
              {n}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Display mode" hint="Vibes mode hides stats and types — pick on aesthetics alone (D-8).">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMode("informed")}
            className={
              opts.mode === "informed"
                ? "rounded border border-emerald-500 bg-emerald-600/20 px-2 py-1 text-xs text-emerald-100"
                : "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
            }
          >
            Informed
          </button>
          <button
            type="button"
            onClick={() => setMode("vibes")}
            className={
              opts.mode === "vibes"
                ? "rounded border border-emerald-500 bg-emerald-600/20 px-2 py-1 text-xs text-emerald-100"
                : "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
            }
          >
            Vibes
          </button>
        </div>
      </Field>

      <Field label="Audio">
        <button
          type="button"
          onClick={onToggleAudio}
          className={
            audioEnabled
              ? "rounded border border-emerald-500 bg-emerald-600/20 px-2 py-1 text-xs text-emerald-100"
              : "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
          }
        >
          {audioEnabled ? "🔊 Cry on hover" : "🔇 Cry off"}
        </button>
      </Field>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      {children}
      {hint && (
        <span className="max-w-[18rem] text-[11px] text-neutral-500">{hint}</span>
      )}
    </div>
  );
}
