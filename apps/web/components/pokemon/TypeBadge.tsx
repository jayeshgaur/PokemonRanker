import { typeStyle } from "@/lib/types";

interface Props {
  slug: string;
  size?: "sm" | "md" | "lg";
}

export default function TypeBadge({ slug, size = "md" }: Props) {
  const style = typeStyle(slug);
  const sizeClasses = {
    sm: "px-1.5 py-0.5 text-[10px]",
    md: "px-2 py-0.5 text-xs",
    lg: "px-3 py-1 text-sm",
  }[size];
  return (
    <span
      className={`inline-flex items-center rounded font-bold uppercase tracking-wide ${sizeClasses}`}
      style={{ backgroundColor: style.bg, color: style.text }}
      aria-label={`${style.label} type`}
    >
      {style.label}
    </span>
  );
}
