import { AccountPortfolioResponseSchema, RiskAlertsResponseSchema } from "@tradewise/shared";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "./api";
import { useAuth } from "./auth";
import { DashboardOverview, ProfileStub, WorkspaceStub } from "./DashboardOverview";
import { formatPaise } from "./format";
import { useQuotesSocket } from "./hooks/useQuotesSocket";
import { Spinner } from "./components/ui";

const MarketsPage = lazy(() => import("./Markets").then((module) => ({ default: module.MarketsPage })));
const MarketDetailPage = lazy(() => import("./Markets").then((module) => ({ default: module.MarketDetailPage })));
const OrdersPage = lazy(() => import("./Orders").then((module) => ({ default: module.OrdersPage })));
const PortfolioPage = lazy(() => import("./Portfolio").then((module) => ({ default: module.PortfolioPage })));

const navigation = [
  { label: "Dashboard", path: "/app/dashboard", mark: "D" },
  { label: "Markets", path: "/app/markets", mark: "M" },
  { label: "Orders", path: "/app/orders", mark: "O" },
  { label: "Portfolio", path: "/app/portfolio", mark: "P" },
  { label: "Risk", path: "/app/risk", mark: "R" },
  { label: "Profile", path: "/app/profile", mark: "U" }
];

const pageTitles: Record<string, string> = {
  "/app/dashboard": "Dashboard",
  "/app/markets": "Markets",
  "/app/orders": "Orders",
  "/app/portfolio": "Portfolio",
  "/app/risk": "Risk",
  "/app/profile": "Profile"
};

function Brand() {
  return (
    <Link aria-label="TradeWise workspace home" className="workspace-brand" to="/app/dashboard">
      <span aria-hidden="true" className="workspace-brand-mark">TW</span>
      <span className="workspace-brand-name">TradeWise</span>
    </Link>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  mobileOpen,
  onClose,
  sidebarRef
}: {
  collapsed: boolean;
  onToggle(): void;
  mobileOpen: boolean;
  onClose(): void;
  sidebarRef: React.RefObject<HTMLElement | null>;
}) {
  const { user } = useAuth();
  const links = user?.role === "admin"
    ? [...navigation, { label: "Admin", path: "/admin/users", mark: "A" }]
    : navigation;

  return (
    <>
      {mobileOpen && <button aria-label="Close navigation" className="workspace-scrim" onClick={onClose} type="button" />}
      <aside aria-label="Workspace sidebar" className={`workspace-sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`} ref={sidebarRef}>
        <div className="workspace-sidebar-header">
          <Brand />
          <button aria-label="Close navigation" className="workspace-mobile-close" onClick={onClose} type="button">×</button>
        </div>
        <nav aria-label="Workspace navigation" className="workspace-nav">
          <p className="workspace-nav-label">Workspace</p>
          {links.map((item) => (
            <NavLink
              aria-label={collapsed ? item.label : undefined}
              className={({ isActive }) => `workspace-nav-link ${isActive ? "is-active" : ""}`}
              data-workspace-nav-link=""
              key={item.path}
              onClick={onClose}
              title={collapsed ? item.label : undefined}
              to={item.path}
            >
              <span aria-hidden="true" className="workspace-nav-mark">{item.mark}</span>
              <span className="workspace-nav-text">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="workspace-sidebar-bottom">
          <p>SIMULATED TRADING</p>
          <span>Virtual money only</span>
          <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="workspace-collapse-button" onClick={onToggle} type="button">
            <span aria-hidden="true">{collapsed ? "→" : "←"}</span>
            <span className="workspace-nav-text">{collapsed ? "Expand" : "Collapse sidebar"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}

type RecentOrderEvents = ReturnType<typeof useQuotesSocket>["recentOrderEvents"];

function Notifications({
  onClose,
  recentOrderEvents
}: {
  onClose(): void;
  recentOrderEvents: RecentOrderEvents;
}) {
  const { token } = useAuth();
  const alerts = useQuery({
    queryKey: ["risk", "alerts", 5, 0],
    queryFn: () => apiRequest("/api/risk/alerts?limit=5&offset=0", RiskAlertsResponseSchema, token ?? undefined),
    enabled: token !== null
  });
  const activeAlerts = (alerts.data?.alerts ?? []).filter((alert) => alert.acknowledgedAt === null);

  return (
      <section aria-label="Notifications" className="workspace-popover workspace-notifications" role="dialog">
        <div className="workspace-popover-heading">
          <div><p className="workspace-eyebrow">Account updates</p><h2>Notifications</h2></div>
          <button aria-label="Close notifications" className="workspace-small-close" onClick={onClose} type="button">×</button>
        </div>
        <div className="workspace-notification-group">
          <h3>Risk alerts</h3>
          {alerts.isPending ? <p role="status">Loading risk alerts…</p> :
            alerts.error instanceof Error ? <p className="is-loss" role="alert">Risk alerts could not be loaded: {alerts.error.message}</p> :
              activeAlerts.length === 0 ? <p>No unacknowledged risk alerts.</p> :
                activeAlerts.map((alert) => <p className="workspace-notification" key={alert.id}><span className={`workspace-severity is-${alert.severity}`} />{alert.message}</p>)}
        </div>
        <div className="workspace-notification-group">
          <h3>Recent order updates</h3>
          {recentOrderEvents.length === 0 ? <p>No recent order updates.</p> :
            recentOrderEvents.map((event) => (
              <p className="workspace-notification" key={event.data.id}>
                <span className="workspace-notification-dot" />
                {event.data.eventType.replaceAll("_", " ")} · {event.data.payload.symbol && typeof event.data.payload.symbol === "string" ? event.data.payload.symbol : "Order update"}
              </p>
            ))}
        </div>
      </section>
  );
}

function UserMenu({ onClose }: { onClose(): void }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
      <div className="workspace-popover workspace-user-menu" role="menu">
        <div className="workspace-user-details"><strong>{user?.displayName}</strong><span>{user?.email}</span></div>
        <Link onClick={onClose} role="menuitem" to="/app/profile">Profile</Link>
        <button
          onClick={() => {
            onClose();
            signOut();
            navigate("/login", { replace: true });
          }}
          role="menuitem"
          type="button"
        >Sign out</button>
      </div>
  );
}

function WorkspaceTopbar({
  mobileOpen,
  mobileOpenButtonRef,
  onMobileOpen
}: {
  mobileOpen: boolean;
  mobileOpenButtonRef: React.RefObject<HTMLButtonElement | null>;
  onMobileOpen(): void;
}) {
  const { token } = useAuth();
  const { status, error, recentOrderEvents } = useQuotesSocket();
  const location = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const portfolio = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => apiRequest("/api/v1/portfolio", AccountPortfolioResponseSchema, token ?? undefined),
    enabled: token !== null,
    refetchInterval: 15_000
  });
  const alerts = useQuery({
    queryKey: ["risk", "alerts", 5, 0],
    queryFn: () => apiRequest("/api/risk/alerts?limit=5&offset=0", RiskAlertsResponseSchema, token ?? undefined),
    enabled: token !== null
  });
  const activeAlertCount = (alerts.data?.alerts ?? []).filter((alert) => alert.acknowledgedAt === null).length;
  const title = location.pathname.startsWith("/app/markets/")
    ? "Market detail"
    : pageTitles[location.pathname] ?? "Workspace";
  const closeNotifications = () => setNotificationsOpen(false);
  const closeUserMenu = () => setUserMenuOpen(false);
  const statusLabel = status === "connected" ? "Live connection" : status === "connecting" ? "Connecting to live updates" : "Live connection disconnected";
  const visibleErrors = [
    error,
    portfolio.error instanceof Error ? `Portfolio equity could not be loaded: ${portfolio.error.message}` : null
  ].filter((message): message is string => message !== null);

  useEffect(() => {
    if (!notificationsOpen && !userMenuOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (notificationsOpen && notificationRef.current !== null && !notificationRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
      if (userMenuOpen && userMenuRef.current !== null && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationsOpen, userMenuOpen]);

  return (
    <>
      <header className="workspace-topbar">
      <div className="workspace-topbar-title">
        <button aria-expanded={mobileOpen} aria-label={mobileOpen ? "Close navigation" : "Open navigation"} className="workspace-mobile-open" onClick={onMobileOpen} ref={mobileOpenButtonRef} type="button">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <div>
          <p className="workspace-breadcrumb">Workspace <span>/</span> {title}</p>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="workspace-topbar-actions">
        <div aria-live="polite" className={`workspace-connection is-${status}`} title={error ?? statusLabel}>
          <span aria-hidden="true" className="workspace-connection-dot" />
          <span className="workspace-connection-label">{statusLabel}</span>
          {error !== null && <span className="sr-only"> {error}</span>}
        </div>
        <div className="workspace-equity-chip">
          <span>Equity</span>
          <strong>{portfolio.isPending ? "—" : portfolio.error !== null ? "Unavailable" : portfolio.data === undefined ? "—" : formatPaise(portfolio.data.totalEquityPaise)}</strong>
        </div>
        <div className="workspace-actions-popovers">
          <div className="workspace-popover-wrap" ref={notificationRef}>
            <NotificationButton
              activeAlertCount={activeAlertCount}
              expanded={notificationsOpen}
              orderEventCount={recentOrderEvents.length}
              onClick={() => { setUserMenuOpen(false); setNotificationsOpen((open) => !open); }}
            />
            {notificationsOpen && <Notifications onClose={closeNotifications} recentOrderEvents={recentOrderEvents} />}
          </div>
          <div className="workspace-popover-wrap" ref={userMenuRef}>
            <UserMenuButton
              expanded={userMenuOpen}
              onClick={() => { setNotificationsOpen(false); setUserMenuOpen((open) => !open); }}
            />
            {userMenuOpen && <UserMenu onClose={closeUserMenu} />}
          </div>
        </div>
      </div>
      </header>
      {visibleErrors.length > 0 && <p className="workspace-socket-error" role="status">{visibleErrors.join(" ")}</p>}
    </>
  );
}

function NotificationButton({
  onClick,
  activeAlertCount,
  orderEventCount,
  expanded
}: {
  onClick(): void;
  activeAlertCount: number;
  orderEventCount: number;
  expanded: boolean;
}) {
  const count = activeAlertCount + orderEventCount;
  return (
    <button aria-label={`Notifications, ${count} updates`} aria-expanded={expanded} aria-haspopup="dialog" className={`workspace-icon-button ${expanded ? "is-selected" : ""}`} onClick={onClick} type="button">
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {count > 0 && <span className="workspace-notification-count">{count > 9 ? "9+" : count}</span>}
    </button>
  );
}

function UserMenuButton({ onClick, expanded }: { onClick(): void; expanded: boolean }) {
  const { user, avatarUrl } = useAuth();
  return (
    <>
      <button aria-expanded={expanded} aria-haspopup="menu" aria-label={`User menu for ${user?.displayName ?? "account"}`} className="workspace-user-trigger" onClick={onClick} type="button">
        {avatarUrl === null
          ? <span aria-hidden="true" className="workspace-avatar">{user?.displayName.slice(0, 1).toUpperCase()}</span>
          : <img alt="" className="workspace-avatar" src={avatarUrl} />}
        <span className="workspace-user-name">{user?.displayName}</span><span aria-hidden="true" className="workspace-chevron">⌄</span>
      </button>
    </>
  );
}

export function WorkspaceLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileOpenButtonRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);

  useEffect(() => {
    if (mobileOpen) {
      drawerWasOpen.current = true;
      sidebarRef.current?.querySelector<HTMLAnchorElement>("[data-workspace-nav-link]")?.focus();
    } else if (drawerWasOpen.current) {
      drawerWasOpen.current = false;
      mobileOpenButtonRef.current?.focus();
    }
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  return (
    <div className="workspace-shell">
      <a className="workspace-skip-link" href="#main-content">Skip to main content</a>
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onToggle={() => setCollapsed((value) => !value)}
        sidebarRef={sidebarRef}
      />
      <div className="workspace-main">
        <WorkspaceTopbar
          mobileOpen={mobileOpen}
          mobileOpenButtonRef={mobileOpenButtonRef}
          onMobileOpen={() => setMobileOpen((value) => !value)}
        />
        <main className="workspace-content" id="main-content" tabIndex={-1}>
          <Suspense fallback={<div className="workspace-loading"><Spinner label="Loading workspace page" /></div>}>
            <Routes>
              <Route element={<Navigate replace to="/app/dashboard" />} index />
              <Route element={<DashboardOverview />} path="dashboard" />
              <Route element={<MarketsPage />} path="markets" />
              <Route element={<MarketDetailPage />} path="markets/:symbol" />
              <Route element={<OrdersPage />} path="orders" />
              <Route element={<PortfolioPage />} path="portfolio" />
              <Route element={<WorkspaceStub detail="Risk warnings and concentration are summarized on the dashboard. Dedicated risk controls are not available yet." title="Risk" />} path="risk" />
              <Route element={<ProfileStub />} path="profile" />
              <Route element={<WorkspaceStub detail="This workspace route is not implemented yet." title="Page not found" />} path="*" />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
