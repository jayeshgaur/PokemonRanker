import Link from "next/link";
import {
  applyNode,
  parseFilter,
  presetBySlug,
  type Filter,
} from "@pokemon-ranker/filter";
import {
  loadPokedex,
  pokedexAvailable,
  pokedexPathHint,
} from "@/lib/pokedex";
import FilterSidebar from "@/components/picker/FilterSidebar";
import PickerScreen from "@/components/picker/PickerScreen";
import { parsePickerOpts } from "@/lib/url-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PickPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  if (!pokedexAvailable()) {
    return <PokedexMissing />;
  }

  const { pool, facets } = loadPokedex();
  const pickerOpts = parsePickerOpts(sp);

  // Resolve filter spec: preset slug wins, otherwise parse explicit fields.
  const presetSlugRaw = typeof sp.preset === "string" ? sp.preset : Array.isArray(sp.preset) ? sp.preset[0] : undefined;
  const preset = presetSlugRaw ? presetBySlug(presetSlugRaw) : undefined;
  const filterForUI: Filter = preset && "spec" in preset
    ? // For sidebar display only: if the preset is a flat Filter, use it.
      // FilterNode (composed) presets show empty primitives and an "Active
      // preset" pill in the sidebar.
      isFlatFilter(preset.spec)
      ? preset.spec
      : {}
    : parseFilter(sp);

  const candidates = preset
    ? applyNode(preset.spec, pool)
    : applyNode(filterForUI, pool);

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Favorite Pokémon Picker
          </h1>
          <p className="text-sm text-neutral-400">
            {candidates.length} Pokémon match{candidates.length === 1 ? "" : "es"} your current filter.
          </p>
        </div>
        <Link
          href="/"
          className="text-sm text-neutral-400 underline-offset-2 hover:underline"
        >
          ← Home
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <FilterSidebar
          facets={facets}
          current={filterForUI}
          pickerOpts={pickerOpts}
          activePresetSlug={preset ? presetSlugRaw ?? null : null}
          eligibleCount={candidates.length}
          totalPool={pool.length}
          hasTags={facets.tags.length > 0}
        />
        <PickerScreen
          filter={filterForUI}
          candidates={candidates}
          pickerOpts={pickerOpts}
          presetSlug={preset ? (presetSlugRaw ?? null) : null}
        />
      </div>
    </main>
  );
}

function isFlatFilter(spec: unknown): spec is Filter {
  if (!spec || typeof spec !== "object") return false;
  return !("kind" in spec);
}

function PokedexMissing() {
  const path = pokedexPathHint();
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-bold">Pokédex not built yet</h1>
      <p className="text-neutral-400">
        The picker reads <code className="rounded bg-neutral-800 px-1.5 py-0.5">{path}</code>{" "}
        but it doesn&apos;t exist. Run the sync once:
      </p>
      <pre className="rounded bg-neutral-900 px-4 py-3 text-left text-sm text-emerald-300">
        make sync-from-clone
      </pre>
      <p className="text-xs text-neutral-500">
        First run pulls a ~16 MB clone of PokeAPI/api-data.
      </p>
    </main>
  );
}
