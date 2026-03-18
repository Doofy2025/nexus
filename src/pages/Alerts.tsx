import { useState } from "react";
import { Bell, CheckCircle, AlertTriangle, XCircle, Filter, Clock, ArrowRight } from "lucide-react";

type Severity = "all" | "critical" | "warning" | "info";

const alertsData = [
  { id: 1, severity: "critical", title: "Storage Service Degraded", source: "prod-storage-01", time: "2m ago", description: "Disk I/O latency exceeding 300ms threshold", acknowledged: false },
  { id: 2, severity: "critical", title: "SSL Certificate Expiring", source: "api.vanguard.io", time: "15m ago", description: "Certificate expires in 7 days", acknowledged: false },
  { id: 3, severity: "critical", title: "Pod CrashLoopBackOff", source: "k8s/prod/worker-12", time: "31m ago", description: "Container restarting every 45 seconds", acknowledged: true },
  { id: 4, severity: "warning", title: "Database Connection Pool High", source: "db-cluster-primary", time: "23m ago", description: "Connection pool usage at 87%", acknowledged: false },
  { id: 5, severity: "warning", title: "Memory Pressure Detected", source: "web-server-08", time: "45m ago", description: "Memory usage at 91% for 15 minutes", acknowledged: false },
  { id: 6, severity: "warning", title: "DNS Resolution Slow", source: "edge-us-west-2", time: "1h ago", description: "DNS lookup averaging 150ms", acknowledged: true },
  { id: 7, severity: "warning", title: "Disk Space Low", source: "log-server-03", time: "2h ago", description: "Only 12% disk space remaining on /var/log", acknowledged: false },
  { id: 8, severity: "info", title: "Agent Updated Successfully", source: "batch-update-group-A", time: "3h ago", description: "142 agents updated to v2.4.1", acknowledged: true },
  { id: 9, severity: "info", title: "Maintenance Window Completed", source: "db-cluster-secondary", time: "4h ago", description: "Scheduled maintenance completed successfully", acknowledged: true },
];

const severityStyles = {
  critical: { border: "border-l-critical", icon: <XCircle className="w-4 h-4 text-critical" /> },
  warning: { border: "border-l-warning", icon: <AlertTriangle className="w-4 h-4 text-warning" /> },
  info: { border: "border-l-primary", icon: <Bell className="w-4 h-4 text-primary" /> },
};

const Alerts = () => {
  const [filter, setFilter] = useState<Severity>("all");

  const filtered = alertsData.filter((a) => filter === "all" || a.severity === filter);
  const critCount = alertsData.filter((a) => a.severity === "critical").length;
  const warnCount = alertsData.filter((a) => a.severity === "warning").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">Alert Console</h1>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-critical/10 text-critical font-medium">{critCount} Critical</span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-warning/10 text-warning font-medium">{warnCount} Warning</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {(["all", "critical", "warning", "info"] as Severity[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs rounded transition-colors capitalize ${
              filter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((alert) => {
          const style = severityStyles[alert.severity as keyof typeof severityStyles];
          return (
            <div
              key={alert.id}
              className={`border-l-2 ${style.border} rounded border border-border bg-card p-3 hover:bg-muted/30 transition-colors cursor-pointer`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{style.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{alert.title}</span>
                    <div className="flex items-center gap-2">
                      {alert.acknowledged && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">ACK</span>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {alert.time}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="font-mono text-[10px] text-muted-foreground">{alert.source}</span>
                    <button className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                      Investigate <ArrowRight className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Alerts;
