import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "bg-emerald-400 text-slate-950 hover:bg-emerald-300 focus-visible:ring-emerald-400",
  secondary: "border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800 focus-visible:ring-cyan-400",
  danger: "bg-rose-500 text-white hover:bg-rose-400 focus-visible:ring-rose-400",
  ghost: "text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:ring-indigo-400"
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
}

export function Button({ className = "", variant = "primary", type = "button", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      type={type}
      {...props}
    />
  );
}
