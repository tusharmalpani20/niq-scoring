import { RulePage } from "./rules/RulePage";
import { useEffect, useRef, useState } from "react";
import {
  createBrowserRouter,
  RouterProvider,
  NavLink,
  useLocation,
  Navigate,
  useNavigate,
} from "react-router-dom";
import {
  LayoutDashboard,
  Users as UsersIcon,
  Building2,
  Server,
  Layers3,
  LogOut,
  CircleUserRound,
  ChevronDown,
} from "lucide-react";
import { request, message, type User } from "./api";
import { Auth } from "./Auth";
import { Users } from "./Users";
import { Operations, type Overview } from "./Operations";
import { OverviewGreeting } from "./OverviewGreeting";
import { AdminDashboard } from "./AdminDashboard";
import { ClientDetail } from "./ClientDetail";
import { DeploymentDetail } from "./DeploymentDetail";
import { Button } from "./components/ui/button";
import { ErrorNotice } from "./shared";
import { clientUrl, deploymentUrl, resolveClient, resolveDeployment } from "./record-urls";
const pages = [
  {
    path: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    description: "Your scoring operations at a glance.",
  },
  {
    path: "users",
    label: "Users",
    icon: UsersIcon,
    description: "Manage access for your NIQ administration team.",
  },
  {
    path: "clients",
    label: "Clients",
    icon: Building2,
  },
  {
    path: "deployments",
    label: "Deployments",
    icon: Server,
    description: "Connect and activate NIQ application installations.",
  },
  {
    path: "versions",
    label: "Rules",
    icon: Layers3,
    description: "Review scoring rule packages and their status.",
  },
];
const router = createBrowserRouter([{ path: "*", element: <Console /> }]);
export function App() { return <RouterProvider router={router} />; }
function Console() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overviewError, setOverviewError] = useState("");
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const requestSequence = useRef(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const needsOverview = !["/", "/overview", "/users"].includes(location.pathname) && !/^\/versions\/[^/]+$/.test(location.pathname);
  const [invitationToken, setInvitationToken] = useState(() =>
    location.pathname === "/accept-invitation"
      ? (new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "")
      : "",
  );
  async function initialize() {
    setLoading(true);
    setConnectionError("");
    try {
      const status = await request<{ setupRequired: boolean }>("/auth/status");
      setSetup(status.setupRequired);
      if (!status.setupRequired) {
        const response = await fetch("/api/auth/session", {
          credentials: "same-origin",
        });
        if (response.ok) setUser((await response.json()).user);
        else if (response.status !== 401)
          throw new Error("Unable to check your session. Please try again.");
      }
    } catch (c) {
      setConnectionError(message(c));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void initialize();
    const expired = () => {
      requestSequence.current += 1;
      setUser(null);
      setData(null);
      setOverviewError("");
    };
    window.addEventListener("session-expired", expired);
    return () => {
      requestSequence.current += 1;
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  async function refresh() {
    const sequence = ++requestSequence.current;
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const next = await request<Overview>("/admin/overview");
      if (sequence !== requestSequence.current) throw new Error("Page refresh was interrupted. Please try again.");
      setData(next);
    } catch (c) {
      if (sequence === requestSequence.current) {
        setOverviewError(message(c));
      }
      throw c;
    } finally {
      if (sequence === requestSequence.current) setOverviewLoading(false);
    }
  }
  useEffect(() => {
    if (user && needsOverview && !data) void refresh().catch(() => {});
  }, [user, needsOverview]);
  if (loading)
    return (
      <div className="loading" role="status">
        Connecting to NIQ scoring…
      </div>
    );
  if (!user && connectionError)
    return (
      <div className="loading">
        <ErrorNotice error={connectionError} />
        <Button onClick={initialize}>Try again</Button>
      </div>
    );
  if (!user || (invitationToken && location.pathname === "/accept-invitation"))
    return (
      <Auth
        setupRequired={setup}
        invitationToken={
          location.pathname === "/accept-invitation" ? invitationToken : ""
        }
        onSetup={() => setSetup(false)}
        onInvitationAccepted={() => {
          requestSequence.current += 1;
          setInvitationToken("");
          setUser(null);
          setData(null);
          setOverviewError("");
          navigate("/login", { replace: true });
        }}
        onLogin={(u) => {
          requestSequence.current += 1;
          setUser(u);
          setData(null);
          setError("");
          setOverviewError("");
          navigate("/overview", { replace: true });
        }}
      />
    );
  if (["/customers", "/organizations"].includes(location.pathname))
    return <Navigate to="/clients" replace />;
  const ruleId = location.pathname.match(/^\/versions\/([^/]+)$/)?.[1];
  const clientSegment = location.pathname.match(/^\/clients\/([^/]+)$/)?.[1];
  const deploymentMatch = location.pathname.match(/^\/deployments\/([^/]+)\/([^/]+)(?:\/(settings|tokens))?$/);
  const legacyDeploymentMatch = location.pathname.match(/^\/deployments\/([^/]+)(?:\/(settings|tokens))?$/);
  const deploymentSegment = deploymentMatch && deploymentMatch[2] !== "settings" && deploymentMatch[2] !== "tokens" ? deploymentMatch[2] : legacyDeploymentMatch?.[1];
  const client = data && clientSegment ? resolveClient(data, clientSegment) : undefined;
  const deployment = data && deploymentSegment ? resolveDeployment(data, deploymentSegment) : undefined;
  const clientId = client?.id ?? clientSegment;
  const deploymentId = deployment?.id ?? deploymentSegment;
  const page = pages.find((p) => `/${p.path}` === location.pathname || (p.path === "versions" && ruleId) || (p.path === "clients" && clientSegment) || (p.path === "deployments" && deploymentSegment));
  if (!page) return <Navigate to="/overview" replace />;
  if (client && location.pathname !== clientUrl(client)) return <Navigate to={clientUrl(client)} replace />;
  if (data && deployment) {
    const queryTab = new URLSearchParams(location.search).get("tab");
    const pathTab = deploymentMatch?.[3] ?? legacyDeploymentMatch?.[2];
    const tab = pathTab === "settings" || pathTab === "tokens" ? pathTab : queryTab === "settings" || queryTab === "tokens" ? queryTab : "overview";
    const canonical = deploymentUrl(data, deployment, tab);
    if (`${location.pathname}${location.search}` !== canonical) return <Navigate to={canonical} replace />;
  }
  const initials = user.displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  async function signOut() {
    setLoggingOut(true);
    try {
      await request("/auth/logout", {});
      requestSequence.current += 1;
      setUser(null);
      setData(null);
      setError("");
      setOverviewError("");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <div className="scoring-workspace">
      <header className="scoring-header" aria-label="Workspace header">
        <div className="scoring-header-inner">
          <NavLink to="/overview" className="scoring-brand" aria-label="NIQ scoring overview">
            <img src="/nutra-iq-logo.png" alt="" />
          </NavLink>
          <details className="scoring-account">
            <summary role="button" aria-label={`Account menu for ${user.displayName}`}>
              <span className="scoring-account-avatar" aria-hidden="true">{initials || <CircleUserRound size={18} />}</span>
              <span className="scoring-account-name">{user.displayName}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="scoring-account-menu">
              <strong>{user.displayName}</strong>
              <small>Administrator</small>
              <Button variant="ghost" disabled={loggingOut} onClick={() => { void signOut(); }}><LogOut size={16} aria-hidden="true" />Sign out</Button>
            </div>
          </details>
        </div>
      </header>
      <div className="workspace">
        <main className="page-content">
          {!ruleId && !clientSegment && !deploymentSegment && <header className="page-header" aria-label={page.path === "overview" ? "Overview greeting" : undefined}>
            {page.path === "overview" ? <OverviewGreeting displayName={user.displayName} /> : <h1>{page.label}</h1>}
          </header>}
          <ErrorNotice error={error} />
          {page.path !== "users" && page.path !== "overview" && !ruleId && data && overviewError && (
            <div className="space-y-3">
              <ErrorNotice error={overviewError} />
              <Button variant="outline" disabled={overviewLoading} onClick={() => void refresh().catch(() => {})}>Try again</Button>
            </div>
          )}
          {ruleId ? <RulePage key={ruleId} id={ruleId}/> : page.path === "overview" ? (
            <AdminDashboard />
          ) : page.path === "users" ? (
            <Users currentUser={user} />
          ) : data && clientId ? <ClientDetail key={clientId} data={data} clientId={clientId} refresh={refresh} /> : data && deploymentId ? <DeploymentDetail key={deploymentId} data={data} deploymentId={deploymentId} refresh={refresh} /> : data ? (
            <Operations
              key={page.path}
              page={page.path}
              data={data}
              refresh={refresh}
            />
          ) : (
            overviewError ? (
              <div className="space-y-3">
                <ErrorNotice error={overviewError} />
                <Button variant="outline" disabled={overviewLoading} onClick={() => void refresh().catch(() => {})}>Try again</Button>
              </div>
            ) : (
              <p role="status">Loading scoring operations…</p>
            )
          )}
        </main>
      </div>
      <nav className="scoring-dock" aria-label="Main navigation">
        {pages.map(item => <NavLink key={item.path} to={`/${item.path}`} className="scoring-dock-item" aria-current={page.path === item.path ? "page" : undefined}>
          <item.icon size={20} aria-hidden="true" />
          <span>{item.label}</span>
        </NavLink>)}
      </nav>
    </div>
  );
}
