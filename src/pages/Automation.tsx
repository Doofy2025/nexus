import { Play, Pause, CheckCircle, Clock, AlertTriangle, Plus, Zap, Code, GitBranch, RefreshCw } from "lucide-react";

const workflows = [
  { id: 1, name: "SSL Certificate Auto-Renewal", status: "active", lastRun: "5m ago", nextRun: "24h", runs: 847, successRate: 99.8, trigger: "Schedule", type: "remediation" },
  { id: 2, name: "Patch Compliance Scan", status: "running", lastRun: "In progress", nextRun: "—", runs: 312, successRate: 97.2, trigger: "Schedule", type: "scan" },
  { id: 3, name: "Disk Cleanup on Threshold", status: "active", lastRun: "2h ago", nextRun: "On trigger", runs: 1203, successRate: 99.1, trigger: "Alert", type: "remediation" },
  { id: 4, name: "New Server Onboarding", status: "active", lastRun: "1d ago", nextRun: "On trigger", runs: 89, successRate: 100, trigger: "Webhook", type: "provisioning" },
  { id: 5, name: "Log Rotation - Production", status: "active", lastRun: "1h ago", nextRun: "6h", runs: 4521, successRate: 99.9, trigger: "Schedule", type: "maintenance" },
  { id: 6, name: "Security Posture Remediation", status: "paused", lastRun: "3d ago", nextRun: "Paused", runs: 56, successRate: 94.6, trigger: "Policy", type: "security" },
  { id: 7, name: "Container Scaling Policy", status: "active", lastRun: "10m ago", nextRun: "On trigger", runs: 2847, successRate: 99.7, trigger: "Metric", type: "scaling" },
];

const statusStyles = {
  active: { icon: <CheckCircle className="w-3.5 h-3.5 text-success" />, label: "Active" },
  running: { icon: <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />, label: "Running" },
  paused: { icon: <Pause className="w-3.5 h-3.5 text-muted-foreground" />, label: "Paused" },
  failed: { icon: <AlertTriangle className="w-3.5 h-3.5 text-critical" />, label: "Failed" },
};

const Automation = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Automation Console</h1>
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity">
          <Plus className="w-3.5 h-3.5" /> New Workflow
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Active Workflows", value: "42", icon: Zap },
          { label: "Executions Today", value: "1,847", icon: Play },
          { label: "Success Rate", value: "99.4%", icon: CheckCircle },
          { label: "Avg Duration", value: "12.3s", icon: Clock },
        ].map((s) => (
          <div key={s.label} className="rounded border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <s.icon className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="text-xl font-semibold font-mono text-foreground">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Workflows table */}
      <div className="rounded border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Workflow</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Trigger</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Last Run</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Next Run</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Runs</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Success Rate</th>
            </tr>
          </thead>
          <tbody>
            {workflows.map((wf) => {
              const style = statusStyles[wf.status as keyof typeof statusStyles];
              return (
                <tr key={wf.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {style.icon}
                      <span className="text-xs text-muted-foreground">{style.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs font-medium text-foreground">{wf.name}</td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{wf.trigger}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{wf.lastRun}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{wf.nextRun}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{wf.runs.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`font-mono text-xs ${wf.successRate >= 99 ? "text-success" : wf.successRate >= 95 ? "text-warning" : "text-critical"}`}>
                      {wf.successRate}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Automation;
