import { useEffect, useState } from "react";
import {
  BrowserRouter,
  NavLink,
  useLocation,
  Navigate,
  useNavigate,
} from "react-router-dom";
import {
  LayoutDashboard,
  Users as UsersIcon,
  Building2,
  Network,
  Server,
  Layers3,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { request, message, type User } from "./api";
import { Auth } from "./Auth";
import { Users } from "./Users";
import { Operations, type Overview } from "./Operations";
import { Button } from "./components/ui/button";
import { ErrorNotice } from "./shared";
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
    path: "customers",
    label: "Customers",
    icon: Building2,
    description: "Manage customers using NIQ scoring services.",
  },
  {
    path: "organizations",
    label: "Organizations",
    icon: Network,
    description: "Manage organization access and monthly limits.",
  },
  {
    path: "deployments",
    label: "Deployments",
    icon: Server,
    description: "Connect and activate NIQ application installations.",
  },
  {
    path: "versions",
    label: "Rule versions",
    icon: Layers3,
    description: "Review scoring rule packages and their status.",
  },
];
export function App() {
  return (
    <BrowserRouter>
      <Console />
    </BrowserRouter>
  );
}
function Console() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
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
      setUser(null);
      setData(null);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function refresh() {
    setData(await request<Overview>("/admin/overview"));
  }
  useEffect(() => {
    if (user) refresh().catch((c) => setError(message(c)));
  }, [user]);
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
          setInvitationToken("");
          setUser(null);
          setData(null);
          navigate("/login", { replace: true });
        }}
        onLogin={(u) => {
          setUser(u);
          setError("");
          navigate("/overview", { replace: true });
        }}
      />
    );
  const page = pages.find((p) => `/${p.path}` === location.pathname);
  if (!page) return <Navigate to="/overview" replace />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brandmark">
          NIQ<span>Scoring</span>
        </div>
        <div className="nav-label">ADMINISTRATION</div>
        <nav>
          {pages.map((p) => (
            <NavLink key={p.path} to={`/${p.path}`}>
              <p.icon size={18} />
              {p.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ShieldCheck size={18} />
          <p>
            NIQ administrators only<small>Central scoring console</small>
          </p>
        </div>
      </aside>
      <div className="workspace">
        <div className="topbar">
          <span>
            NIQ scoring / <strong>{page.label}</strong>
          </span>
          <div className="account">
            <div>
              <strong>{user.displayName}</strong>
              <small>Administrator</small>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={loggingOut}
              onClick={async () => {
                setLoggingOut(true);
                try {
                  await request("/auth/logout", {});
                  setUser(null);
                  setData(null);
                  setError("");
                } catch (c) {
                  setError(message(c));
                } finally {
                  setLoggingOut(false);
                }
              }}
            >
              <LogOut size={16} /> Sign out
            </Button>
          </div>
        </div>
        <main>
          <header className="page-header">
            <p className="eyebrow">SCORING CONTROL</p>
            <h1>{page.label}</h1>
            <p>{page.description}</p>
          </header>
          <ErrorNotice error={error} />
          {page.path === "users" ? (
            <Users currentUser={user} />
          ) : data ? (
            <Operations
              key={page.path}
              page={page.path}
              data={data}
              refresh={refresh}
            />
          ) : (
            <p role="status">Loading scoring operations…</p>
          )}
        </main>
      </div>
    </div>
  );
}
