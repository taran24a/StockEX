import { useMemo, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  sortable?: boolean;
  value?: (row: Row) => string | number | null;
  render?: (row: Row) => ReactNode;
  className?: string;
}

export function DataTable<Row>({
  columns,
  data,
  getRowKey,
  pageSize = 10,
  emptyTitle = "No records yet",
  emptyDescription = "There is no data to display."
}: {
  columns: DataTableColumn<Row>[];
  data: Row[];
  getRowKey(row: Row): string;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"ascending" | "descending">("ascending");
  const [page, setPage] = useState(0);
  const sortedData = useMemo(() => {
    if (sortKey === null) {
      return data;
    }
    const column = columns.find((candidate) => candidate.key === sortKey);
    if (column?.value === undefined) {
      return data;
    }
    const getValue = column.value;
    return [...data].sort((left, right) => {
      const leftValue = getValue(left);
      const rightValue = getValue(right);
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, { numeric: true });
      return sortDirection === "ascending" ? comparison : -comparison;
    });
  }, [columns, data, sortDirection, sortKey]);
  const pageCount = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = sortedData.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  function toggleSort(column: DataTableColumn<Row>): void {
    if (column.sortable !== true || column.value === undefined) {
      return;
    }
    if (sortKey === column.key) {
      setSortDirection((direction) => direction === "ascending" ? "descending" : "ascending");
    } else {
      setSortKey(column.key);
      setSortDirection("ascending");
    }
    setPage(0);
  }

  if (data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((column) => (
                <th
                  aria-sort={sortKey === column.key ? sortDirection : "none"}
                  className={`px-4 py-3 font-medium ${column.className ?? ""}`}
                  key={column.key}
                  scope="col"
                >
                  {column.sortable === true ? (
                    <button className="inline-flex items-center gap-1 hover:text-slate-200" onClick={() => toggleSort(column)} type="button">
                      {column.header}
                      <span aria-hidden="true">{sortKey === column.key ? sortDirection === "ascending" ? "↑" : "↓" : "↕"}</span>
                    </button>
                  ) : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950/50">
            {visibleRows.map((row) => (
              <tr className="text-slate-300" key={getRowKey(row)}>
                {columns.map((column) => (
                  <td className={`px-4 py-3 ${column.className ?? ""}`} key={column.key}>
                    {column.render?.(row) ?? column.value?.(row) ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav aria-label="Table pagination" className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, sortedData.length)} of {sortedData.length}
        </p>
        <div className="flex gap-2">
          <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} variant="secondary">Previous</Button>
          <Button disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} variant="secondary">Next</Button>
        </div>
      </nav>
    </div>
  );
}
