"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import {
  canonicalKey,
  type EvolutionStage,
  type Filter,
  type FormInclusionMode,
  PRESETS,
  toSearchParams,
} from "@pokemon-ranker/filter";
import type { Facets } from "@/lib/pokedex";
import {
  pickerOptsToParams,
  type PickerOpts,
} from "@/lib/url-state";

interface Props {
  facets: Facets;
  current: Filter;
  pickerOpts: PickerOpts;
  activePresetSlug: string | null;
  eligibleCount: number;
  totalPool: number;
  hasTags: boolean;
}

// Group presets for the chip layout. Order chosen so the most-used groups
// (per-gen, by-type) are at the top of the column.
const PRESET_GROUPS: { label: string; slugs: string[] }[] = [
  { label: "Per-Generation", slugs: ["gen-1", "gen-2", "gen-3", "gen-4", "gen-5", "gen-6", "gen-7", "gen-8", "gen-9"] },
  { label: "By Type", slugs: ["kanto-fire", "kanto-water", "kanto-grass", "kanto-electric", "kanto-psychic", "dragons", "ghosts", "psychics"] },
  { label: "Status", slugs: ["all-legendaries", "all-mythicals", "legendaries-and-mythicals", "babies"] },
  { label: "Form Filter", slugs: ["fully-evolved", "fully-evolved-no-mega", "megas-only", "gmax-only", "regional-variants"] },
  { label: "Curated", slugs: ["eeveelutions", "starters-final"] },
  { label: "BST", slugs: ["bst-600-679", "high-bst"] },
  { label: "Tag-based (needs tags.yaml)", slugs: ["starters", "pseudo-legendaries", "ultra-beasts", "paradox", "fossils"] },
];

const FORM_OPTIONS: { value: FormInclusionMode; label: string }[] = [
  { value: "final-evolutions-excluding-mega", label: "Final evos, no Mega/GMax (default)" },
  { value: "all-forms", label: "All forms" },
  { value: "default-forms-only", label: "Default forms only" },
  { value: "final-evolutions-only", label: "Final evos (incl. Mega/GMax)" },
  { value: "only-megas", label: "Megas only" },
  { value: "only-gmax", label: "GMax only" },
  { value: "only-paradox", label: "Paradox only" },
  { value: "only-regional-variants", label: "Regional variants only" },
];

const STAGE_OPTIONS: { value: EvolutionStage; label: string }[] = [
  { value: "first", label: "1st" },
  { value: "middle", label: "Mid" },
  { value: "final", label: "Final" },
];

export default function FilterSidebar({
  facets,
  current,
  pickerOpts,
  activePresetSlug,
  eligibleCount,
  totalPool,
  hasTags,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Filter>(current);
  const [advanced, setAdvanced] = useState(false);

  // Re-sync the local draft when the URL-driven `current` filter changes
  // (e.g., user clicked a preset chip that navigated and rewrote the
  // filter). Without this, a stale draft from before the navigation could
  // overwrite the new filter when "Apply" is clicked. Per Phase 4 code-
  // reviewer review B-1.
  const currentKey = canonicalKey(current);
  useEffect(() => {
    setDraft(current);
    // Intentionally key on the canonical hash, not the object identity —
    // server props are recreated on every navigation but the hash is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const presetMap = useMemo(() => {
    const m = new Map<string, (typeof PRESETS)[number]>();
    for (const p of PRESETS) m.set(p.slug, p);
    return m;
  }, []);

  function navigate(params: URLSearchParams) {
    pickerOptsToParams(pickerOpts, params);
    const qs = params.toString();
    const url = (qs ? `${pathname}?${qs}` : pathname) as Route;
    startTransition(() => router.push(url));
  }

  function applyDraft() {
    navigate(toSearchParams(draft));
  }

  function applyPreset(slug: string) {
    const params = new URLSearchParams();
    params.set("preset", slug);
    navigate(params);
  }

  function clearAll() {
    setDraft({});
    navigate(new URLSearchParams());
  }

  function toggleArrayValue<T>(arr: T[] | undefined, value: T): T[] | undefined {
    const list = arr ?? [];
    const exists = list.includes(value);
    const next = exists ? list.filter((v) => v !== value) : [...list, value];
    return next.length === 0 ? undefined : next;
  }

  function setBst(field: "bstMin" | "bstMax", raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setDraft((d) => ({ ...d, [field]: undefined }));
      return;
    }
    const n = Number.parseInt(trimmed, 10);
    if (Number.isFinite(n)) {
      setDraft((d) => ({ ...d, [field]: n }));
    }
  }

  function setTriState(
    field: "isLegendary" | "isMythical" | "isBaby",
    next: boolean | undefined,
  ) {
    setDraft((d) => ({ ...d, [field]: next }));
  }

  return (
    <aside className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
      <div>
        <h2 className="text-base font-bold">Filter</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {eligibleCount} match{eligibleCount === 1 ? "" : "es"} of {totalPool} Pokémon
        </p>
        {activePresetSlug && (
          <p className="mt-1 text-xs text-emerald-400">
            Preset: {presetMap.get(activePresetSlug)?.name ?? activePresetSlug}
          </p>
        )}
      </div>

      {/* Preset chips */}
      <Section title="Quick presets">
        <div className="flex flex-col gap-2">
          {PRESET_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.slugs.map((slug) => {
                  const p = presetMap.get(slug);
                  if (!p) return null;
                  const dim = p.requiresTags && !hasTags;
                  const active = activePresetSlug === slug;
                  return (
                    <button
                      key={slug}
                      type="button"
                      title={dim ? `${p.description} (waits on tags.yaml)` : p.description}
                      disabled={dim}
                      onClick={() => applyPreset(slug)}
                      className={
                        active
                          ? "rounded border border-emerald-500 bg-emerald-600/30 px-2 py-1 text-xs text-emerald-100"
                          : dim
                            ? "rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-600"
                            : "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500"
                      }
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <hr className="border-neutral-800" />

      {/* Manual filter — generation */}
      <Section title="Generation">
        <div className="flex flex-wrap gap-1.5">
          {facets.generations.map((g) => {
            const active = draft.generationIds?.includes(g.id) ?? false;
            return (
              <Chip
                key={g.id}
                active={active}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    generationIds: toggleArrayValue(d.generationIds, g.id),
                  }))
                }
                title={g.name}
              >
                {g.id}
              </Chip>
            );
          })}
        </div>
      </Section>

      {/* Type */}
      <Section title="Type">
        <div className="flex flex-wrap gap-1.5">
          {facets.types.map((t) => {
            const active = draft.typeSlugs?.includes(t.slug) ?? false;
            return (
              <Chip
                key={t.slug}
                active={active}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    typeSlugs: toggleArrayValue(d.typeSlugs, t.slug),
                  }))
                }
              >
                {t.name}
              </Chip>
            );
          })}
        </div>
      </Section>

      {/* Form-inclusion radio */}
      <Section title="Forms">
        <select
          value={draft.formInclusion ?? "final-evolutions-excluding-mega"}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              formInclusion: e.target.value as FormInclusionMode,
            }))
          }
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200"
        >
          {FORM_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </Section>

      {/* Evolution stage */}
      <Section title="Evolution stage">
        <div className="flex flex-wrap gap-1.5">
          {STAGE_OPTIONS.map((opt) => {
            const active = draft.evolutionStages?.includes(opt.value) ?? false;
            return (
              <Chip
                key={opt.value}
                active={active}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    evolutionStages: toggleArrayValue(d.evolutionStages, opt.value),
                  }))
                }
              >
                {opt.label}
              </Chip>
            );
          })}
        </div>
      </Section>

      {/* Categorical flags */}
      <Section title="Status">
        <div className="flex flex-wrap gap-1.5">
          <TriToggle
            label="Legendary"
            value={draft.isLegendary}
            onChange={(v) => setTriState("isLegendary", v)}
          />
          <TriToggle
            label="Mythical"
            value={draft.isMythical}
            onChange={(v) => setTriState("isMythical", v)}
          />
          <TriToggle
            label="Baby"
            value={draft.isBaby}
            onChange={(v) => setTriState("isBaby", v)}
          />
        </div>
      </Section>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="text-left text-xs text-neutral-400 underline-offset-2 hover:underline"
      >
        {advanced ? "▾ Advanced" : "▸ Advanced (BST, tags)"}
      </button>

      {advanced && (
        <>
          <Section title="Base stat total">
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                placeholder="min"
                value={draft.bstMin ?? ""}
                onChange={(e) => setBst("bstMin", e.target.value)}
                className="w-20 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs"
              />
              <span className="text-neutral-500">–</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="max"
                value={draft.bstMax ?? ""}
                onChange={(e) => setBst("bstMax", e.target.value)}
                className="w-20 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs"
              />
            </div>
          </Section>

          {facets.tags.length > 0 && (
            <Section title="Tags">
              <div className="flex flex-wrap gap-1.5">
                {facets.tags.map((tag) => {
                  const active = draft.tagSlugs?.includes(tag.slug) ?? false;
                  return (
                    <Chip
                      key={tag.slug}
                      active={active}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          tagSlugs: toggleArrayValue(d.tagSlugs, tag.slug),
                        }))
                      }
                    >
                      {tag.name}
                    </Chip>
                  );
                })}
              </div>
            </Section>
          )}
        </>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={applyDraft}
          disabled={pending}
          className="flex-1 rounded bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          {pending ? "Applying…" : "Apply manual filter"}
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={pending}
          className="rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:border-neutral-500 disabled:opacity-60"
        >
          Reset
        </button>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={
        active
          ? "rounded border border-emerald-500 bg-emerald-600/20 px-2 py-1 text-xs text-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          : "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
      }
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

// Tri-state toggle: undefined ⇒ "any", true ⇒ "yes", false ⇒ "no". Click
// cycles undefined → true → false → undefined.
function TriToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
}) {
  function next() {
    if (value === undefined) onChange(true);
    else if (value === true) onChange(false);
    else onChange(undefined);
  }
  const cls =
    value === true
      ? "rounded border border-emerald-500 bg-emerald-600/20 px-2 py-1 text-xs text-emerald-100"
      : value === false
        ? "rounded border border-rose-500 bg-rose-600/20 px-2 py-1 text-xs text-rose-100"
        : "rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500";
  const indicator =
    value === true ? "✓ " : value === false ? "✗ " : "";
  return (
    <button type="button" onClick={next} className={cls}>
      {indicator}
      {label}
    </button>
  );
}
