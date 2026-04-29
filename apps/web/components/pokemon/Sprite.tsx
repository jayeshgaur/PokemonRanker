"use client";

import { useState } from "react";

interface Props {
  src: string;
  alt: string;
  className?: string;
}

export default function Sprite({ src, alt, className }: Props) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div
        className={`flex items-center justify-center rounded-full bg-neutral-800 text-xs text-neutral-500 ${className ?? ""}`}
        aria-label="(no sprite available)"
      >
        ?
      </div>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      className={`object-contain ${className ?? ""}`}
      onError={() => setErrored(true)}
      loading="lazy"
    />
  );
}
