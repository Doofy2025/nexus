import { LucideIcon, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down";
  icon: LucideIcon;
  variant?: "default" | "warning" | "critical";
}

export function MetricCard({ label, value, change, trend, icon: Icon, variant = "default" }: MetricCardProps) {
  const borderColor =
    variant === "critical"
      ? "border-l-critical"
      : variant === "warning"
      ? "border-l-warning"
      : "border-l-primary";

  return (
    <div className={`rounded border border-border bg-card p-3 border-l-2 ${borderColor}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="text-xl font-semibold text-foreground font-mono">{value}</div>
      <div className="flex items-center gap-1 mt-1">
        {trend === "up" ? (
          <ArrowUpRight className={`w-3 h-3 ${variant === "critical" ? "text-critical" : "text-success"}`} />
        ) : (
          <ArrowDownRight className="w-3 h-3 text-success" />
        )}
        <span className="text-xs text-muted-foreground">{change}</span>
      </div>
    </div>
  );
}
