import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";

interface Row {
  id: string;
  symbol: string;
  change: number;
}

const rows: Row[] = [
  { id: "one", symbol: "ALFA", change: 3 },
  { id: "two", symbol: "BRAVO", change: -2 },
  { id: "three", symbol: "CIRRUS", change: 1 }
];

describe("DataTable", () => {
  it("sorts values and paginates rows", () => {
    render(
      <DataTable
        columns={[
          { key: "symbol", header: "Symbol", sortable: true, value: (row) => row.symbol },
          { key: "change", header: "Change", sortable: true, value: (row) => row.change }
        ]}
        data={rows}
        getRowKey={(row) => row.id}
        pageSize={2}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /change/i }));
    expect(within(screen.getAllByRole("row")[1]!).getByText("BRAVO")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 3–3 of 3")).toBeTruthy();
    expect(screen.getByText("ALFA")).toBeTruthy();
    expect(screen.queryByText("BRAVO")).toBeNull();
  });

  it("shows a reusable empty state when no rows are present", () => {
    render(
      <DataTable<{ symbol: string }>
        columns={[{ key: "symbol", header: "Symbol" }]}
        data={[]}
        getRowKey={(row) => row.symbol}
        emptyTitle="No instruments"
      />
    );
    expect(screen.getByText("No instruments")).toBeTruthy();
  });
});
