import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Server,
  Network,
  Bell,
  Zap,
  Shield,
  Smartphone,
  Cloud,
  Search,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
  FileText,
  Users,
  Building2,
  ClipboardList,
  LogOut,
  Clock,
  MapPin,
  Rocket,
} from "lucide-react";

interface NavItem {
  icon: React.ElementType;
  label: string;
  path: string;
  badge?: number;
  roles?: string[];
}

const primaryNav: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: MapPin, label: "Sites", path: "/sites" },
  { icon: Server, label: "Inventory", path: "/inventory" },
  { icon: Network, label: "Topology", path: "/topology" },
  { icon: Activity, label: "Observability", path: "/observability" },
  { icon: Bell, label: "Alerts", path: "/alerts", badge: 12 },
  { icon: Zap, label: "Automation", path: "/automation" },
  { icon: Shield, label: "Security", path: "/security" },
  { icon: Smartphone, label: "Mobile", path: "/mobile" },
  { icon: Cloud, label: "Cloud", path: "/cloud" },
  { icon: FileText, label: "Reports", path: "/reports" },
  { icon: Rocket, label: "Agent Deploy", path: "/agents" },
];

const adminNav: NavItem[] = [
  { icon: Users, label: "Users", path: "/users", roles: ["super_admin", "tenant_admin"] },
  { icon: Building2, label: "Tenants", path: "/tenants", roles: ["super_admin", "tenant_admin"] },
  { icon: ClipboardList, label: "Audit Log", path: "/audit", roles: ["super_admin", "tenant_admin"] },
];

const bottomNav: NavItem[] = [
  { icon: Settings, label: "Settings", path: "/settings" },
];

export function AppSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const { user, tenant, logout, hasRole, sessionTimeLeft } = useAuth();

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isSessionWarning = sessionTimeLeft < 300; // < 5 min

  const visibleAdminNav = adminNav.filter(item =>
    !item.roles || item.roles.some(r => hasRole(r as any))
  );

  return (
    <aside
      className={`flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-primary-foreground font-bold text-xs">V</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm text-sidebar-accent-foreground whitespace-nowrap">
              Vanguard OS
            </span>
          )}
        </div>
      </div>

      {/* Session timer */}
      {!collapsed && (
        <div className={`mx-2 mt-2 px-3 py-1.5 rounded text-xs flex items-center gap-1.5 ${
          isSessionWarning ? "bg-critical/20 text-critical" : "bg-sidebar-accent text-sidebar-muted"
        }`}>
          <Clock className="w-3 h-3" />
          Session: {formatTime(sessionTimeLeft)}
        </div>
      )}

      {/* Search trigger */}
      <button
        className="flex items-center gap-2 mx-2 mt-2 mb-1 px-3 py-2 rounded text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors text-xs"
        onClick={() => document.dispatchEvent(new CustomEvent("open-command"))}
      >
        <Search className="w-4 h-4 flex-shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Search…</span>
            <kbd className="text-[10px] font-mono bg-sidebar-accent px-1.5 py-0.5 rounded">⌘K</kbd>
          </>
        )}
      </button>

      {/* Primary nav */}
      <nav className="flex-1 px-2 mt-2 space-y-0.5 overflow-y-auto">
        {primaryNav.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors duration-150 ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="flex-1 whitespace-nowrap">{item.label}</span>}
              {!collapsed && item.badge && (
                <span className="bg-critical text-critical-foreground text-[10px] font-medium px-1.5 py-0.5 rounded-full leading-none">
                  {item.badge}
                </span>
              )}
            </NavLink>
          );
        })}

        {/* Admin section */}
        {visibleAdminNav.length > 0 && (
          <>
            {!collapsed && (
              <div className="pt-3 pb-1 px-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">Admin</span>
              </div>
            )}
            {visibleAdminNav.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors duration-150 ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span className="flex-1 whitespace-nowrap">{item.label}</span>}
                </NavLink>
              );
            })}
          </>
        )}
      </nav>

      {/* Bottom nav */}
      <div className="px-2 pb-2 space-y-0.5">
        {/* User info */}
        {!collapsed && user && (
          <div className="px-3 py-2 mb-1">
            <div className="text-xs font-medium text-sidebar-accent-foreground truncate">{user.displayName}</div>
            <div className="text-[10px] text-sidebar-muted truncate">{user.email}</div>
            {tenant && <div className="text-[10px] text-sidebar-muted truncate">{tenant.name}</div>}
          </div>
        )}
        {bottomNav.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors duration-150 ${
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
        <button
          onClick={logout}
          className="flex items-center gap-2.5 px-3 py-2 rounded text-sm text-critical hover:bg-critical/10 transition-colors w-full"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2.5 px-3 py-2 rounded text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors w-full"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
