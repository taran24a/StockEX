import type { ReactNode } from "react";

const tones = {
  success: "border-emerald-800 bg-emerald-950 text-emerald-200",
  error: "border-rose-800 bg-rose-950 text-rose-200",
  info: "border-cyan-800 bg-slate-900 text-cyan-100"
} as const;

export function Toast({
  tone = "info",
  title,
  children,
  onDismiss
}: {
  tone?: keyof typeof tones;
  title: string;
  children?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-xl border p-4 shadow-lg ${tones[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {children !== undefined && <div className="mt-1 text-sm opacity-80">{children}</div>}
      </div>
      {onDismiss !== undefined && (
        <button aria-label="Dismiss notification" className="text-lg leading-none opacity-70 hover:opacity-100" onClick={onDismiss} type="button">
          ×
        </button>
      )}
    </div>
  );
}
