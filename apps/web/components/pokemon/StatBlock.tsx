import { bst, type Stats } from "@pokemon-ranker/shared";

interface Props {
  stats: Stats;
  compact?: boolean;
}

const STAT_DEFS: { key: keyof Stats; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "attack", label: "Atk" },
  { key: "defense", label: "Def" },
  { key: "specialAttack", label: "SpA" },
  { key: "specialDefense", label: "SpD" },
  { key: "speed", label: "Spe" },
];

const MAX_STAT = 200;

function statColor(value: number): string {
  if (value >= 130) return "#3FA129";
  if (value >= 100) return "#A8C040";
  if (value >= 70) return "#FAC000";
  if (value >= 50) return "#FF8000";
  return "#E62829";
}

export default function StatBlock({ stats, compact = false }: Props) {
  const total = bst(stats);
  return (
    <div className={compact ? "space-y-0.5" : "space-y-1"}>
      {STAT_DEFS.map(({ key, label }) => {
        const value = stats[key];
        const pct = Math.min(100, (value / MAX_STAT) * 100);
        return (
          <div key={key} className="grid grid-cols-[2.4rem_2.4rem_1fr] items-center gap-2 text-xs">
            <span className="font-mono text-neutral-400">{label}</span>
            <span className="font-mono text-right text-neutral-200">{value}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: statColor(value) }}
                aria-hidden="true"
              />
            </div>
          </div>
        );
      })}
      <div className="mt-1 flex justify-between text-xs text-neutral-300">
        <span className="font-mono text-neutral-500">BST</span>
        <span className="font-mono font-bold">{total}</span>
      </div>
    </div>
  );
}
