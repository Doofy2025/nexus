import { Server, Monitor, Cloud, Smartphone, Container, AlertTriangle, CheckCircle, XCircle, Activity, Zap, Shield, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { StatusGrid } from "@/components/dashboard/StatusGrid";
import { AlertsFeed } from "@/components/dashboard/AlertsFeed";
import { ResourceChart } from "@/components/dashboard/ResourceChart";
import { TopologyMini } from "@/components/dashboard/TopologyMini";
import { AutomationFeed } from "@/components/dashboard/AutomationFeed";

const Dashboard = () => {
  return (
    <div className="space-y-4">
      {/* Top metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Total Assets"
          value="12,847"
          change="+142"
          trend="up"
          icon={Server}
        />
        <MetricCard
          label="Endpoints Online"
          value="11,923"
          change="98.2%"
          trend="up"
          icon={Monitor}
        />
        <MetricCard
          label="Cloud Resources"
          value="3,291"
          change="+38"
          trend="up"
          icon={Cloud}
        />
        <MetricCard
          label="Mobile Devices"
          value="2,104"
          change="94.1% compliant"
          trend="up"
          icon={Smartphone}
        />
        <MetricCard
          label="Active Alerts"
          value="47"
          change="-12"
          trend="down"
          icon={AlertTriangle}
          variant="warning"
        />
        <MetricCard
          label="Critical Issues"
          value="3"
          change="+1"
          trend="up"
          icon={XCircle}
          variant="critical"
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left: Status + Resource chart */}
        <div className="lg:col-span-2 space-y-3">
          <StatusGrid />
          <ResourceChart />
        </div>

        {/* Right: Alerts feed */}
        <div className="space-y-3">
          <AlertsFeed />
          <AutomationFeed />
        </div>
      </div>

      {/* Bottom: Topology mini + extra */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TopologyMini />
        <div className="rounded border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-foreground">Security Posture</h3>
            <Shield className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-semibold text-success">94%</div>
              <div className="text-xs text-muted-foreground mt-1">Compliance Score</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-foreground">847</div>
              <div className="text-xs text-muted-foreground mt-1">Policies Active</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-warning">23</div>
              <div className="text-xs text-muted-foreground mt-1">Drift Detected</div>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {[
              { label: "Endpoint Protection", value: 98, color: "bg-success" },
              { label: "Patch Compliance", value: 91, color: "bg-success" },
              { label: "Config Compliance", value: 87, color: "bg-warning" },
              { label: "Certificate Health", value: 95, color: "bg-success" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-32 shrink-0">{item.label}</span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.value}%` }} />
                </div>
                <span className="text-xs font-mono text-foreground w-8 text-right">{item.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
