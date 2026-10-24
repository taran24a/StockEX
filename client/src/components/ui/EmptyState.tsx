import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-800 px-6 py-8 text-center">
      <div>
        <h3 className="font-medium text-slate-200">{title}</h3>
        {description !== undefined && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        {action !== undefined && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
