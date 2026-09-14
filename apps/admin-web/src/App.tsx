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
  Server,
  Layers3,
  LogOut,
  CircleUserRound,
} from "lucide-react";
import { request, message, type User } from "./api";
import { Auth } from "./Auth";
import { Users } from "./Users";
import { Operations, type Overview } from "./Operations";
import { Button } from "./components/ui/button";
import { Sidebar, SidebarProvider, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger } from "./components/ui/sidebar";
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
  if (["/customers", "/organizations"].includes(location.pathname))
    return <Navigate to="/clients" replace />;
  const page = pages.find((p) => `/${p.path}` === location.pathname);
  if (!page) return <Navigate to="/overview" replace />;
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-6 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center gap-3 whitespace-nowrap text-3xl font-extrabold tracking-tight text-foreground group-data-[collapsible=icon]:hidden">
          NIQ<span className="border-l pl-3 text-sm font-medium tracking-normal text-muted-foreground">Scoring</span>
        </div>
          <span className="hidden text-center text-xs font-extrabold text-foreground group-data-[collapsible=icon]:block">NIQ</span>
        </SidebarHeader>
        <SidebarContent>
        <SidebarGroup>
        <SidebarMenu>
          {pages.map((p) => (
            <SidebarMenuItem key={p.path}>
            <SidebarMenuButton asChild isActive={page.path === p.path} tooltip={p.label}>
            <NavLink to={`/${p.path}`}>
              <p.icon size={18} />
              <span>{p.label}</span>
            </NavLink>
            </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="flex-row items-center justify-between gap-2 border-t p-4 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:p-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs group-data-[collapsible=icon]:flex-none">
            <CircleUserRound size={24} className="shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <strong className="block truncate" title={user.displayName}>{user.displayName}</strong>
              <small>Administrator</small>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            title="Sign out"
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
            <LogOut size={18} aria-hidden="true" />
          </Button>
        </SidebarFooter>
      </Sidebar>
      <div className="workspace">
        <main className="page-content">
          <SidebarTrigger title="Toggle sidebar" />
          <header className="page-header">
            <h1>{page.label}</h1>
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
    </SidebarProvider>
  );
}
