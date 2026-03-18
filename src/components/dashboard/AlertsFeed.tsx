import { Bell, ArrowRight } from "lucide-react";

const alerts = [
  { id: 1, severity: "critical", title: "Storage Service Degraded", source: "prod-storage-01", time: "2m ago", description: "Disk I/O latency exceeding 300ms threshold" },
  { id: 2, severity: "critical", title: "SSL Certificate Expiring", source: "api.vanguard.io", time: "15m ago", description: "Certificate expires in 7 days" },
  { id: 3, severity: "warning", title: "Database Connection Pool", source: "db-cluster-primary", time: "23m ago", description: "Connection pool usage at 87%" },
  { id: 4, severity: "critical", title: "Pod CrashLoopBackOff", source: "k8s/prod/worker-12", time: "31m ago", description: "Container restarting every 45 seconds" },
  { id: 5, severity: "warning", title: "Memory Pressure", source: "web-server-08", time: "45m ago", description: "Memory usage at 91% for 15 minutes" },
  { id: 6, severity: "warning", title: "DNS Resolution Slow", source: "edge-us-west-2", time: "1h ago", description: "DNS lookup averaging 150ms" },
];

const severityClasses = {
  critical: "border-l-critical bg-critical/5",
  warning: "border-l-warning bg-warning/5",
  info: "border-l-primary bg-primary/5",
};

export function AlertsFeed() {
  return (
    <div className="rounded border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Active Alerts</h3>
        <button className="text-xs text-primary hover:underline flex items-center gap-1">
          View all <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`border-l-2 rounded-r px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity ${
              severityClasses[alert.severity as keyof typeof severityClasses]
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{alert.title}</span>
              <span className="text-[10px] text-muted-foreground">{alert.time}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{alert.description}</div>
            <div className="text-[10px] font-mono text-muted-foreground mt-1">{alert.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
