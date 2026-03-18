import { CheckCircle, Clock, Play, Zap } from "lucide-react";

const workflows = [
  { name: "SSL Cert Auto-Renew", status: "completed", time: "5m ago", icon: CheckCircle, iconClass: "text-success" },
  { name: "Patch Compliance Scan", status: "running", time: "In progress", icon: Play, iconClass: "text-primary" },
  { name: "Log Rotation - Prod", status: "completed", time: "1h ago", icon: CheckCircle, iconClass: "text-success" },
  { name: "Disk Cleanup Workflow", status: "scheduled", time: "In 2h", icon: Clock, iconClass: "text-muted-foreground" },
];

export function AutomationFeed() {
  return (
    <div className="rounded border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Recent Automation</h3>
        <Zap className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        {workflows.map((wf, i) => (
          <div key={i} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors cursor-pointer">
            <wf.icon className={`w-3.5 h-3.5 ${wf.iconClass} flex-shrink-0`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground truncate">{wf.name}</div>
              <div className="text-[10px] text-muted-foreground">{wf.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
