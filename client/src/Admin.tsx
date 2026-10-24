import {
  AdminAuditResponseSchema,
  AdminInstrumentImportResponseSchema,
  AdminUserSchema,
  AdminStatsResponseSchema,
  AdminUsersResponseSchema,
  ErrorResponseSchema,
  SimulationControlRequestSchema,
  SimulationControlsResponseSchema,
  type AdminAuditResponse,
  type AdminInstrumentImportResponse,
  type AdminUser,
  type SimulationControlsResponse
} from "@tradewise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react";
import { apiRequest } from "./api";
import { useAuth } from "./auth";
import { formatPaise } from "./format";

const pageSize = 20;

function AdminMessage({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`admin-message ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>{children}</p>;
}

function uploadCsv(file: File, token: string, onProgress: (percent: number) => void): Promise<AdminInstrumentImportResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";
    request.open("POST", `${apiBaseUrl}/api/admin/instruments/import`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("Accept", "application/json");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        let message = `CSV import failed (HTTP ${request.status}).`;
        try {
          const payload: unknown = JSON.parse(request.responseText);
          const parsed = ErrorResponseSchema.safeParse(payload);
          if (parsed.success) message = parsed.data.error.message;
        } catch {
          message = `CSV import failed (HTTP ${request.status}); the server returned an invalid error response.`;
        }
        reject(new Error(message));
        return;
      }
      try {
        const payload: unknown = JSON.parse(request.responseText);
        resolve(AdminInstrumentImportResponseSchema.parse(payload));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("CSV import returned an invalid response."));
      }
    });
    request.addEventListener("error", () => reject(new Error("CSV import could not reach the server.")));
    request.addEventListener("abort", () => reject(new Error("CSV import was cancelled.")));
    const form = new FormData();
    form.set("file", file);
    request.send(form);
  });
}

function StatsCards({ token }: { token: string }) {
  const stats = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiRequest("/api/admin/stats", AdminStatsResponseSchema, token)
  });

  return (
    <section aria-labelledby="admin-stats-heading" className="admin-section">
      <div className="admin-section-heading"><div><p className="admin-eyebrow">Platform overview</p><h2 id="admin-stats-heading">System statistics</h2></div></div>
      {stats.isPending ? <AdminMessage>Loading platform statistics…</AdminMessage> :
        stats.error instanceof Error ? <AdminMessage error>Statistics could not be loaded: {stats.error.message}</AdminMessage> :
          stats.data !== undefined && (
            <div className="admin-stats-grid">
              <article><span>Registered users</span><strong>{stats.data.users.toLocaleString()}</strong></article>
              <article><span>Total orders</span><strong>{stats.data.orders.toLocaleString()}</strong></article>
              <article><span>Executed volume</span><strong>{formatPaise(stats.data.volumePaise)}</strong></article>
              <article><span>Rejected orders</span><strong>{stats.data.rejectedOrderPct.toFixed(1)}%</strong></article>
            </div>
          )}
    </section>
  );
}

function UsersPanel({ token, userId }: { token: string; userId: string }) {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const usersQuery = useQuery({
    queryKey: ["admin", "users", offset],
    queryFn: () => apiRequest(`/api/admin/users?limit=${pageSize}&offset=${offset}`, AdminUsersResponseSchema, token)
  });
  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: AdminUser["role"] }) =>
      apiRequest(`/api/admin/users/${id}/role`, AdminUserSchema, token, {
        method: "PATCH",
        body: JSON.stringify({ role })
      }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
  });

  return (
    <section aria-labelledby="admin-users-heading" className="admin-section">
      <div className="admin-section-heading"><div><p className="admin-eyebrow">Accounts</p><h2 id="admin-users-heading">User management</h2></div></div>
      {usersQuery.isPending ? <AdminMessage>Loading users…</AdminMessage> :
        usersQuery.error instanceof Error ? <AdminMessage error>Users could not be loaded: {usersQuery.error.message}</AdminMessage> :
          usersQuery.data !== undefined && (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Action</th></tr></thead>
                  <tbody>
                    {usersQuery.data.users.map((listedUser) => (
                      <tr key={listedUser.id}>
                        <td>{listedUser.displayName}</td>
                        <td>{listedUser.email}</td>
                        <td><span className={`admin-role-badge is-${listedUser.role}`}>{listedUser.role}</span></td>
                        <td>{new Date(listedUser.createdAt).toLocaleDateString()}</td>
                        <td>
                          {listedUser.id === userId ? <span className="admin-muted">Current account</span> : (
                            <button
                              className="admin-inline-button"
                              disabled={updateRole.isPending}
                              onClick={() => updateRole.mutate({ id: listedUser.id, role: listedUser.role === "admin" ? "user" : "admin" })}
                              type="button"
                            >Make {listedUser.role === "admin" ? "user" : "admin"}</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {usersQuery.data.users.length === 0 && <tr><td colSpan={5}>No users found.</td></tr>}
                  </tbody>
                </table>
              </div>
              {updateRole.error instanceof Error && <AdminMessage error>Role update failed: {updateRole.error.message}</AdminMessage>}
              {updateRole.isSuccess && <AdminMessage>User role updated.</AdminMessage>}
              <div className="admin-pagination">
                <span>{usersQuery.data.pagination.total.toLocaleString()} users</span>
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))} type="button">Previous</button>
                <button disabled={offset + pageSize >= usersQuery.data.pagination.total} onClick={() => setOffset(offset + pageSize)} type="button">Next</button>
              </div>
            </>
          )}
    </section>
  );
}

function ImportPanel({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const importMutation = useMutation({
    mutationFn: (selected: File) => uploadCsv(selected, token, setProgress),
    onSuccess: () => setProgress(100)
  });
  function selectFile(selected: File | undefined): void {
    importMutation.reset();
    setProgress(0);
    setFileError(null);
    if (selected === undefined) {
      setFile(null);
      return;
    }
    if (!selected.name.toLowerCase().endsWith(".csv")) {
      setFile(null);
      setFileError("Choose a file with a .csv extension.");
      return;
    }
    setFile(selected);
    if (inputRef.current !== null) inputRef.current.value = "";
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    selectFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  return (
    <section aria-labelledby="admin-import-heading" className="admin-section">
      <div className="admin-section-heading"><div><p className="admin-eyebrow">Market catalog</p><h2 id="admin-import-heading">Import instruments</h2></div></div>
      <p className="admin-helper">CSV columns: symbol, name, sector, tick_size, last_price. Prices and tick sizes use paise.</p>
      <div
        className={`admin-dropzone ${isDragging ? "is-dragging" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <strong>Drop a CSV file here</strong>
        <span>or</span>
        <button className="admin-inline-button" onClick={() => inputRef.current?.click()} type="button">Choose file</button>
        <input accept=".csv,text/csv" aria-label="Choose instruments CSV" className="admin-file-input" onChange={onFileChange} ref={inputRef} type="file" />
      </div>
      {fileError !== null && <AdminMessage error>{fileError}</AdminMessage>}
      {file !== null && <p className="admin-selected-file">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}
      {file !== null && (
        <button
          className="admin-primary-button"
          disabled={importMutation.isPending}
          onClick={() => importMutation.mutate(file)}
          type="button"
        >{importMutation.isPending ? "Importing…" : "Import instruments"}</button>
      )}
      {importMutation.isPending && (
        <div aria-label="Upload progress" className="admin-progress" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      {importMutation.error instanceof Error && <AdminMessage error>Import failed: {importMutation.error.message}</AdminMessage>}
      {importMutation.data !== undefined && <AdminMessage>Import complete: {importMutation.data.imported} instrument rows processed.</AdminMessage>}
    </section>
  );
}

function AuditPanel({ token }: { token: string }) {
  const [offset, setOffset] = useState(0);
  const [aggregateType, setAggregateType] = useState("");
  const [eventType, setEventType] = useState("");
  const [aggregateId, setAggregateId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [filters, setFilters] = useState({ aggregateType: "", eventType: "", aggregateId: "", requestId: "" });
  const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
  for (const [key, value] of Object.entries(filters)) {
    if (value.trim() !== "") query.set(key, value.trim());
  }
  const audit = useQuery({
    queryKey: ["admin", "audit", filters, offset],
    queryFn: () => apiRequest(`/api/admin/audit?${query.toString()}`, AdminAuditResponseSchema, token)
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setOffset(0);
    setFilters({ aggregateType, eventType, aggregateId, requestId });
  }

  return (
    <section aria-labelledby="admin-audit-heading" className="admin-section">
      <div className="admin-section-heading"><div><p className="admin-eyebrow">Domain events</p><h2 id="admin-audit-heading">Audit log</h2></div></div>
      <form className="admin-filter-form" onSubmit={submit}>
        <label>Aggregate type<input onChange={(event) => setAggregateType(event.target.value)} value={aggregateType} /></label>
        <label>Event type<input onChange={(event) => setEventType(event.target.value)} value={eventType} /></label>
        <label>Aggregate ID<input onChange={(event) => setAggregateId(event.target.value)} value={aggregateId} /></label>
        <label>Request ID<input onChange={(event) => setRequestId(event.target.value)} value={requestId} /></label>
        <button className="admin-secondary-button" type="submit">Apply filters</button>
      </form>
      {audit.isPending ? <AdminMessage>Loading audit events…</AdminMessage> :
        audit.error instanceof Error ? <AdminMessage error>Audit events could not be loaded: {audit.error.message}</AdminMessage> :
          audit.data !== undefined && <AuditTable data={audit.data} offset={offset} setOffset={setOffset} />}
    </section>
  );
}

function AuditTable({ data, offset, setOffset }: { data: AdminAuditResponse; offset: number; setOffset(offset: number): void }) {
  return (
    <>
      <div className="admin-table-wrap">
        <table className="admin-table admin-audit-table">
          <thead><tr><th>Time</th><th>Aggregate</th><th>Event</th><th>Sequence</th><th>Details</th></tr></thead>
          <tbody>
            {data.events.map((event) => (
              <tr key={event.id}>
                <td className="admin-nowrap">{new Date(event.createdAt).toLocaleString()}</td>
                <td>{event.aggregateType}<small>{event.aggregateId}</small></td>
                <td>{event.eventType}</td>
                <td>{event.sequenceNumber}</td>
                <td><details><summary>View payload</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></td>
              </tr>
            ))}
            {data.events.length === 0 && <tr><td colSpan={5}>No audit events match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="admin-pagination">
        <span>{data.pagination.total.toLocaleString()} events</span>
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))} type="button">Previous</button>
        <button disabled={offset + pageSize >= data.pagination.total} onClick={() => setOffset(offset + pageSize)} type="button">Next</button>
      </div>
    </>
  );
}

function SimulationPanel({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const controls = useQuery({
    queryKey: ["admin", "simulation-controls"],
    queryFn: () => apiRequest("/api/admin/simulation-controls", SimulationControlsResponseSchema, token),
    refetchInterval: 5_000
  });
  const update = useMutation({
    mutationFn: ({ name, running }: { name: "marketMaker" | "ticker"; running: boolean }) => {
      const input = SimulationControlRequestSchema.parse({ name, running });
      return apiRequest("/api/admin/simulation-controls", SimulationControlsResponseSchema, token, {
        method: "PATCH",
        body: JSON.stringify(input)
      });
    },
    onSuccess: async (data) => {
      queryClient.setQueryData<SimulationControlsResponse>(["admin", "simulation-controls"], data);
    }
  });

  return (
    <section aria-labelledby="admin-simulation-heading" className="admin-section">
      <div className="admin-section-heading"><div><p className="admin-eyebrow">Runtime</p><h2 id="admin-simulation-heading">Simulation controls</h2></div></div>
      {controls.isPending ? <AdminMessage>Loading simulation status…</AdminMessage> :
        controls.error instanceof Error ? <AdminMessage error>Simulation status could not be loaded: {controls.error.message}</AdminMessage> :
          controls.data !== undefined && (
            <div className="admin-simulation-list">
              {([
                ["marketMaker", "Market-maker bot", controls.data.marketMaker],
                ["ticker", "Price ticker", controls.data.ticker]
              ] as const).map(([name, label, status]) => (
                <div className="admin-simulation-row" key={name}>
                  <div><strong>{label}</strong><span className={`admin-simulation-state ${status.running ? "is-running" : "is-paused"}`}>
                    {!status.available ? "Unavailable" : status.running ? "Running" : "Paused"}
                  </span></div>
                  <button
                    className={status.running ? "admin-secondary-button" : "admin-primary-button"}
                    disabled={!status.available || update.isPending}
                    onClick={() => update.mutate({ name, running: !status.running })}
                    type="button"
                  >{status.running ? "Pause" : "Resume"}</button>
                </div>
              ))}
            </div>
          )}
      {update.error instanceof Error && <AdminMessage error>Simulation control failed: {update.error.message}</AdminMessage>}
    </section>
  );
}

export function AdminPage() {
  const { token, user } = useAuth();
  if (token === null || user?.role !== "admin") {
    return <AdminMessage error>Administrator authentication is required.</AdminMessage>;
  }
  return (
    <main className="admin-workspace">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">Platform operations</p>
        <h1>Admin workspace</h1>
        <p>Manage accounts, market instruments, audit activity, and simulation services.</p>
      </header>
      <StatsCards token={token} />
      <SimulationPanel token={token} />
      <UsersPanel token={token} userId={user.id} />
      <ImportPanel token={token} />
      <AuditPanel token={token} />
    </main>
  );
}
