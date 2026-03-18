import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { FileText, AlertTriangle, ShieldAlert, Info, Search } from "lucide-react";

const severityConfig = {
  info: { icon: Info, color: "text-primary", bg: "bg-primary/10" },
  warning: { icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10" },
  critical: { icon: ShieldAlert, color: "text-critical", bg: "bg-critical/10" },
};

const AuditLog = () => {
  const { auditLog, hasRole } = useAuth();
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const filtered = auditLog
    .filter(e => severityFilter === "all" || e.severity === severityFilter)
    .filter(e =>
      e.userEmail.toLowerCase().includes(search.toLowerCase()) ||
      e.action.toLowerCase().includes(search.toLowerCase()) ||
      e.details.toLowerCase().includes(search.toLowerCase())
    );

  const criticalCount = auditLog.filter(e => e.severity === "critical").length;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Security Audit Log</h1>
          {criticalCount > 0 && (
            <span className="text-xs bg-critical/10 text-critical px-2 py-0.5 rounded font-medium">
              {criticalCount} critical
            </span>
          )}
        </div>
      </div>

      {/* Unauthorized access alert banner */}
      {auditLog.some(e => e.action === "UNAUTHORIZED_ACCESS" || e.action === "BRUTE_FORCE_DETECTED") && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-critical/10 border border-critical/20">
          <ShieldAlert className="w-5 h-5 text-critical flex-shrink-0" />
          <div>
            <div className="text-sm font-semibold text-critical">Security Alert</div>
            <div className="text-xs text-critical/80">Unauthorized access attempts detected. Review critical entries below.</div>
          </div>
        </div>
      )}

      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground"
            placeholder="Search audit log…"
          />
        </div>
        <div className="flex gap-1">
          {["all", "info", "warning", "critical"].map(s => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                severityFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              {s !== "all" && ` (${auditLog.filter(e => e.severity === s).length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left p-3 font-medium text-muted-foreground w-8"></th>
              <th className="text-left p-3 font-medium text-muted-foreground">Timestamp</th>
              <th className="text-left p-3 font-medium text-muted-foreground">User</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Action</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Details</th>
              <th className="text-left p-3 font-medium text-muted-foreground">IP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(entry => {
              const cfg = severityConfig[entry.severity];
              return (
                <tr key={entry.id} className={`border-b border-border last:border-0 ${entry.severity === "critical" ? "bg-critical/5" : "hover:bg-muted/20"}`}>
                  <td className="p-3">
                    <cfg.icon className={`w-4 h-4 ${cfg.color}`} />
                  </td>
                  <td className="p-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="p-3 text-xs text-foreground">{entry.userEmail}</td>
                  <td className="p-3">
                    <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground max-w-xs truncate">{entry.details}</td>
                  <td className="p-3 text-xs font-mono text-muted-foreground">{entry.ipAddress}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditLog;
