import { CheckCircle, AlertTriangle, XCircle, MinusCircle } from "lucide-react";

const services = [
  { name: "API Gateway", status: "healthy", latency: "12ms", uptime: "99.99%" },
  { name: "Auth Service", status: "healthy", latency: "8ms", uptime: "99.98%" },
  { name: "Database Cluster", status: "warning", latency: "45ms", uptime: "99.91%" },
  { name: "Cache Layer", status: "healthy", latency: "2ms", uptime: "100%" },
  { name: "Queue Workers", status: "healthy", latency: "18ms", uptime: "99.97%" },
  { name: "Storage Service", status: "critical", latency: "320ms", uptime: "98.2%" },
  { name: "Search Index", status: "healthy", latency: "25ms", uptime: "99.95%" },
  { name: "CDN Edge", status: "healthy", latency: "5ms", uptime: "99.99%" },
  { name: "ML Pipeline", status: "degraded", latency: "180ms", uptime: "99.5%" },
  { name: "Notification Hub", status: "healthy", latency: "15ms", uptime: "99.96%" },
];

const statusIcon = {
  healthy: <CheckCircle className="w-3.5 h-3.5 text-success" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-warning" />,
  critical: <XCircle className="w-3.5 h-3.5 text-critical status-pulse" />,
  degraded: <MinusCircle className="w-3.5 h-3.5 text-warning" />,
};

export function StatusGrid() {
  return (
    <div className="rounded border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground mb-3">Service Health</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="flex items-center gap-2 px-2.5 py-2 rounded bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
          >
            {statusIcon[svc.status as keyof typeof statusIcon]}
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground truncate">{svc.name}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{svc.latency} · {svc.uptime}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
