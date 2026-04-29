"use client";

import { useState } from "react";
import type { RankedPokemon, Ranking } from "@pokemon-ranker/ranker";
import TypeBadge from "@/components/pokemon/TypeBadge";
import Sprite from "@/components/pokemon/Sprite";
import type { DisplayMode } from "@/lib/url-state";

interface Props {
  ranking: Ranking;
  topN: number;
  mode: DisplayMode;
  algoLabel: string;
  comparisonsDone: number;
  isFinal: boolean;
  onReset: () => void;
  onKeepGoing?: () => void;
}

export default function ResultsList({
  ranking,
  topN,
  mode,
  algoLabel,
  comparisonsDone,
  isFinal,
  onReset,
  onKeepGoing,
}: Props) {
  const podium = ranking.ordered.slice(0, topN);
  const tail = ranking.ordered.slice(topN);

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-neutral-100">
          {isFinal ? "Your ranking" : "Current ranking"}
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          {ranking.ordered.length} Pokémon · {algoLabel} · {comparisonsDone} comparisons
        </p>
        {!isFinal && (
          <p className="mt-1 text-xs text-amber-300">
            Stopped early — keep going to refine, or share what you have.
          </p>
        )}
      </div>

      <Podium podium={podium} mode={mode} />

      {tail.length > 0 && (
        <details className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <summary className="cursor-pointer text-sm font-medium text-neutral-300">
            Full ranking (positions {topN + 1}–{ranking.ordered.length})
          </summary>
          <ol className="mt-3 space-y-1.5">
            {tail.map((item) => (
              <RowItem key={item.pokemon.id} item={item} mode={mode} />
            ))}
          </ol>
        </details>
      )}

      <ShareButton />

      <div className="flex flex-wrap justify-center gap-3">
        {onKeepGoing && (
          <button
            type="button"
            onClick={onKeepGoing}
            className="rounded border border-emerald-700 px-4 py-2 text-sm text-emerald-300 hover:border-emerald-500"
          >
            Keep going (refine)
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          className="rounded bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Run again with this filter
        </button>
      </div>
    </div>
  );
}

function Podium({
  podium,
  mode,
}: {
  podium: RankedPokemon[];
  mode: DisplayMode;
}) {
  const PODIUM_TONE = ["#FFD700", "#C0C0C0", "#CD7F32"];
  return (
    <ol className="flex flex-col gap-3">
      {podium.map((item, idx) => (
        <li
          key={item.pokemon.id}
          className="flex items-center gap-4 rounded-2xl border-2 bg-neutral-900 p-4"
          style={{
            borderColor:
              idx < 3 ? PODIUM_TONE[idx] : "rgb(38 38 38 / 1)",
            boxShadow: idx === 0 ? "0 0 24px rgba(255, 215, 0, 0.15)" : undefined,
          }}
        >
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full font-mono text-lg font-bold"
            style={{
              backgroundColor: idx < 3 ? PODIUM_TONE[idx] : "rgb(38 38 38)",
              color: idx < 3 ? "#000" : "#a3a3a3",
            }}
          >
            #{item.rank}
          </div>
          <Sprite
            src={item.pokemon.officialArtworkUrl || item.pokemon.spriteUrl}
            alt={item.pokemon.displayName}
            className="h-20 w-20"
          />
          <div className="flex-1">
            <p className="text-lg font-bold capitalize text-neutral-100">
              {item.pokemon.displayName.replace(/-/g, " ")}
            </p>
            {mode === "informed" && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                {item.pokemon.types.map((t) => (
                  <TypeBadge key={t} slug={t} size="sm" />
                ))}
                <span>Generation {item.pokemon.generationId}</span>
              </div>
            )}
          </div>
          {item.pokemon.pokedexDbUrl && (
            <a
              href={item.pokemon.pokedexDbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-400 hover:underline"
            >
              PokemonDB ↗
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}

function RowItem({ item, mode }: { item: RankedPokemon; mode: DisplayMode }) {
  return (
    <li className="flex items-center gap-3 rounded border border-neutral-800 bg-neutral-950 p-2">
      <span className="w-8 text-right font-mono text-xs text-neutral-500">
        #{item.rank}
      </span>
      <Sprite
        src={item.pokemon.spriteUrl || item.pokemon.officialArtworkUrl}
        alt=""
        className="h-10 w-10"
      />
      <div className="flex-1">
        <p className="text-sm capitalize text-neutral-100">
          {item.pokemon.displayName.replace(/-/g, " ")}
        </p>
        {mode === "informed" && (
          <div className="mt-0.5 flex items-center gap-1.5">
            {item.pokemon.types.map((t) => (
              <TypeBadge key={t} slug={t} size="sm" />
            ))}
          </div>
        )}
      </div>
      {item.pokemon.pokedexDbUrl && (
        <a
          href={item.pokemon.pokedexDbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-emerald-400 hover:underline"
        >
          ↗
        </a>
      )}
    </li>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  function copy() {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setError(true);
      setTimeout(() => setError(false), 2000);
      return;
    }
    navigator.clipboard.writeText(window.location.href).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // Permission denied or insecure context — surface a soft error
        // rather than letting the rejection become uncaught.
        setError(true);
        setTimeout(() => setError(false), 2000);
      },
    );
  }
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={copy}
        title="Copies the picker URL: filter + algorithm + display options. Your in-progress run stays in localStorage and isn't included."
        className="rounded border border-neutral-700 px-4 py-2 text-xs text-neutral-300 hover:border-emerald-500 hover:text-emerald-300 focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
      >
        {copied
          ? "✓ Copied!"
          : error
            ? "✗ Couldn't copy — copy from address bar"
            : "Copy picker config link"}
      </button>
    </div>
  );
}
