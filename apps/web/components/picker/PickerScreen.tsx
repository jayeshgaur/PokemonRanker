"use client";

import { useEffect, useState } from "react";
import type { Pokemon } from "@pokemon-ranker/shared";
import type { Filter } from "@pokemon-ranker/filter";
import Picker from "./Picker";
import PickerControls from "./PickerControls";
import type { PickerOpts } from "@/lib/url-state";

const AUDIO_KEY = "pokemon-ranker:audio";

interface Props {
  filter: Filter;
  candidates: Pokemon[];
  pickerOpts: PickerOpts;
  presetSlug: string | null;
}

export default function PickerScreen({
  filter,
  candidates,
  pickerOpts,
  presetSlug,
}: Props) {
  const [audioEnabled, setAudioEnabled] = useState(false);

  useEffect(() => {
    try {
      setAudioEnabled(window.localStorage.getItem(AUDIO_KEY) === "1");
    } catch {
      // ignore — localStorage disabled
    }
  }, []);

  function toggleAudio() {
    const next = !audioEnabled;
    setAudioEnabled(next);
    try {
      window.localStorage.setItem(AUDIO_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PickerControls
        opts={pickerOpts}
        candidateCount={candidates.length}
        audioEnabled={audioEnabled}
        onToggleAudio={toggleAudio}
      />
      <Picker
        filter={filter}
        candidates={candidates}
        algo={pickerOpts.algo}
        topN={pickerOpts.topN}
        mode={pickerOpts.mode}
        audioEnabled={audioEnabled}
        presetSlug={presetSlug}
      />
    </div>
  );
}
