"use client";

import { useEffect, useRef } from "react";
import { type Pokemon } from "@pokemon-ranker/shared";
import type { Decision, Progress } from "@pokemon-ranker/ranker";
import StatBlock from "@/components/pokemon/StatBlock";
import TypeBadge from "@/components/pokemon/TypeBadge";
import Sprite from "@/components/pokemon/Sprite";
import type { DisplayMode } from "@/lib/url-state";

interface Props {
  left: Pokemon;
  right: Pokemon;
  progress: Progress;
  mode: DisplayMode;
  audioEnabled: boolean;
  onPick: (decision: Decision) => void;
  onReset: () => void;
  onStopEarly?: () => void;
}

export default function DuelCard({
  left,
  right,
  progress,
  mode,
  audioEnabled,
  onPick,
  onReset,
  onStopEarly,
}: Props) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Only fire when no UI element has focus — otherwise Space on a
      // focused sidebar chip would *both* activate the chip *and* skip the
      // duel. Per Phase 4 code-reviewer review B-2.
      const active = document.activeElement;
      if (active && active !== document.body) {
        // Allow ArrowLeft/Right while focused on the duel cards themselves
        // (covered by their own onClick), but never Space (would double-fire
        // with the focused button's activation).
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPick("left_wins");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onPick("right_wins");
      } else if (e.key === " ") {
        e.preventDefault();
        onPick("skip");
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onPick]);

  return (
    <div className="flex flex-col gap-6">
      <ProgressBar progress={progress} onStopEarly={onStopEarly} />
      <p
        className="-mb-2 text-center text-xs text-neutral-400"
        aria-live="polite"
      >
        <kbd className="rounded border border-neutral-700 px-1.5 py-0.5 font-mono">←</kbd>{" "}
        left wins ·{" "}
        <kbd className="rounded border border-neutral-700 px-1.5 py-0.5 font-mono">→</kbd>{" "}
        right wins ·{" "}
        <kbd className="rounded border border-neutral-700 px-1.5 py-0.5 font-mono">space</kbd>{" "}
        can&apos;t decide
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card pokemon={left} side="left" hint="←" mode={mode} audioEnabled={audioEnabled} onClick={() => onPick("left_wins")} />
        <Card pokemon={right} side="right" hint="→" mode={mode} audioEnabled={audioEnabled} onClick={() => onPick("right_wins")} />
      </div>
      <div className="flex flex-wrap justify-center gap-3 text-xs text-neutral-400">
        <button
          type="button"
          onClick={() => onPick("skip")}
          className="rounded border border-neutral-700 px-3 py-1.5 hover:border-neutral-500"
        >
          Can&apos;t decide (space)
        </button>
        <button
          type="button"
          onClick={() => onPick("draw")}
          className="rounded border border-neutral-700 px-3 py-1.5 hover:border-neutral-500"
          title="Treat the duel as a tie. Effect varies by algorithm."
        >
          Tie
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-neutral-800 px-3 py-1.5 text-neutral-500 hover:border-neutral-600"
        >
          Reset run
        </button>
      </div>
    </div>
  );
}

function Card({
  pokemon,
  side,
  hint,
  mode,
  audioEnabled,
  onClick,
}: {
  pokemon: Pokemon;
  side: "left" | "right";
  hint: string;
  mode: DisplayMode;
  audioEnabled: boolean;
  onClick: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sprite = pokemon.officialArtworkUrl || pokemon.spriteUrl;

  // Re-bind the cached <Audio> to the *current* pokémon's cry whenever the
  // duel changes. Without this, React reuses the same Card component
  // instance across duels (only props change), and `audioRef.current` keeps
  // the first pokémon's Audio object forever — the bug reported 2026-04-29:
  // "same sound for all left pokémon, a different but always-same sound for
  // all right pokémon."
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = 0.3;
      audioRef.current.preload = "auto";
    }
    if (pokemon.cryUrl && audioRef.current.src !== pokemon.cryUrl) {
      audioRef.current.src = pokemon.cryUrl;
    }
  }, [pokemon.cryUrl]);

  function playCry() {
    if (!audioEnabled || !pokemon.cryUrl) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Autoplay restrictions or load failure — fail silently.
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={playCry}
      onFocus={playCry}
      aria-label={`Pick ${pokemon.displayName} (${side})`}
      aria-keyshortcuts={side === "left" ? "ArrowLeft" : "ArrowRight"}
      className="group flex flex-col items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center transition hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/10 focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
    >
      <Sprite
        src={sprite}
        alt={pokemon.displayName}
        className="h-48 w-48"
      />
      <h3 className="text-2xl font-bold capitalize text-neutral-100">
        {pokemon.displayName.replace(/-/g, " ")}
      </h3>
      {mode === "informed" ? (
        <>
          <div className="flex flex-wrap justify-center gap-1.5">
            {pokemon.types.map((t) => (
              <TypeBadge key={t} slug={t} size="md" />
            ))}
          </div>
          <p className="text-xs text-neutral-400">Generation {pokemon.generationId}</p>
          <div className="w-full max-w-[18rem]">
            <StatBlock stats={pokemon.stats} compact />
          </div>
        </>
      ) : (
        <p className="text-xs italic text-neutral-600">
          Vibes mode — pick on looks alone.
        </p>
      )}
      <p className="text-xs text-neutral-500 group-hover:text-emerald-400">
        Press <kbd className="rounded border border-neutral-700 px-1 font-mono text-neutral-400 group-hover:text-emerald-400">{hint}</kbd>
      </p>
    </button>
  );
}

function ProgressBar({
  progress,
  onStopEarly,
}: {
  progress: Progress;
  onStopEarly?: () => void;
}) {
  const pct = Math.round(progress.fraction * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          Comparison {progress.done + 1} of ~{progress.total}
        </span>
        <div className="flex items-center gap-3">
          <span>{pct}%</span>
          {onStopEarly && (
            <button
              type="button"
              onClick={onStopEarly}
              className="rounded border border-emerald-700 px-2 py-0.5 text-[10px] text-emerald-300 hover:border-emerald-500"
              title="Stop now and show the current ranking. (Glicko only)"
            >
              Stop & show ranking
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
