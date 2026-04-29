import Link from "next/link";

const PRESET_HIGHLIGHTS: { label: string; preset: string; tagline: string }[] = [
  { label: "Gen 1 favorites", preset: "gen-1", tagline: "Kanto only" },
  { label: "Eeveelutions", preset: "eeveelutions", tagline: "All eight" },
  { label: "Final-form starters", preset: "starters-final", tagline: "Across all regions" },
  { label: "Legendaries + Mythicals", preset: "legendaries-and-mythicals", tagline: "Ubers tier" },
  { label: "All Megas", preset: "megas-only", tagline: "Mega evolutions" },
  { label: "Pseudo-legendaries", preset: "pseudo-legendaries", tagline: "BST 600 tier" },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Pokemon Ranker
        </h1>
        <p className="mx-auto max-w-xl text-lg text-neutral-300">
          Pick your favorite Pokémon by side-by-side comparison. Filter the
          field, choose your picker style, and share your top.
        </p>
      </div>

      <Link
        href="/pick"
        className="rounded-lg bg-emerald-600 px-8 py-4 text-lg font-medium text-white shadow-md transition hover:-translate-y-0.5 hover:bg-emerald-500 hover:shadow-lg"
      >
        Start picking →
      </Link>

      <div className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Or jump into a preset
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PRESET_HIGHLIGHTS.map((p) => (
            <Link
              key={p.preset}
              href={{ pathname: "/pick", query: { preset: p.preset } }}
              className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left transition hover:border-emerald-500"
            >
              <p className="text-sm font-bold text-neutral-100">{p.label}</p>
              <p className="mt-0.5 text-xs text-neutral-400">{p.tagline}</p>
            </Link>
          ))}
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        Three algorithms · 35 presets · Vibes mode (D-8) · Sound on hover
      </p>
    </main>
  );
}
