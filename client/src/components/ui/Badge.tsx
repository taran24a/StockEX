import type { HTMLAttributes } from "react";

const tones = {
  neutral: "border-slate-700 bg-slate-800 text-slate-300",
  gain: "border-emerald-800 bg-emerald-950/60 text-emerald-300",
  loss: "border-rose-800 bg-rose-950/60 text-rose-300",
  accent: "border-indigo-800 bg-indigo-950/60 text-cyan-300"
} as const;

export function Badge({
  className = "",
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
