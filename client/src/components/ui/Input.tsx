import { useId, type InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className = "", ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-300" htmlFor={inputId}>{label}</label>
      <input
        aria-describedby={error !== undefined || hint !== undefined ? messageId : undefined}
        aria-invalid={error !== undefined}
        className={`w-full rounded-lg border bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50 ${error === undefined ? "border-slate-700" : "border-rose-500"} ${className}`}
        id={inputId}
        {...props}
      />
      {(error !== undefined || hint !== undefined) && (
        <p
          aria-live={error === undefined ? undefined : "assertive"}
          className={`text-xs ${error === undefined ? "text-slate-500" : "text-rose-400"}`}
          id={messageId}
          role={error === undefined ? undefined : "alert"}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
