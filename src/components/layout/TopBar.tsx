import { Bell, RefreshCw, User, Clock, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NavLink } from "react-router-dom";

export function TopBar() {
  const { user, tenant, sessionTimeLeft } = useAuth();
  const isWarning = sessionTimeLeft < 300;

  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-foreground">Mission Control</h2>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-success" />
          All systems operational
        </div>
        {tenant && (
          <span className="text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground">
            {tenant.name}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <NavLink to="/status" className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors text-xs text-muted-foreground">
          <Shield className="w-3.5 h-3.5" />
          Status
        </NavLink>
        <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${isWarning ? "text-critical bg-critical/10" : "text-muted-foreground"}`}>
          <Clock className="w-3.5 h-3.5" />
          {Math.floor(sessionTimeLeft / 60)}m
        </div>
        <button className="p-2 rounded hover:bg-muted transition-colors">
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
        </button>
        <button className="p-2 rounded hover:bg-muted transition-colors relative">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-critical rounded-full" />
        </button>
        <button className="ml-2 flex items-center gap-2 p-1.5 rounded hover:bg-muted transition-colors">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          {user && <span className="text-xs text-foreground hidden md:inline">{user.displayName}</span>}
        </button>
      </div>
    </header>
  );
}
