import { Cloud, Server, Database, Globe, Shield, HardDrive, Layers, CheckCircle, AlertTriangle } from "lucide-react";

const cloudResources = [
  { provider: "AWS", region: "us-east-1", resources: 847, healthy: 839, warnings: 6, critical: 2 },
  { provider: "Azure", region: "East US", resources: 523, healthy: 518, warnings: 4, critical: 1 },
  { provider: "GCP", region: "us-central1", resources: 312, healthy: 310, warnings: 2, critical: 0 },
  { provider: "Oracle Cloud", region: "us-ashburn-1", resources: 89, healthy: 89, warnings: 0, critical: 0 },
];

const resourceTypes = [
  { type: "Compute Instances", count: 342, icon: Server, healthy: 335 },
  { type: "Databases", count: 87, icon: Database, healthy: 84 },
  { type: "Storage Buckets", count: 156, icon: HardDrive, healthy: 156 },
  { type: "Load Balancers", count: 28, icon: Globe, healthy: 27 },
  { type: "K8s Clusters", count: 12, icon: Layers, healthy: 11 },
  { type: "Security Groups", count: 234, icon: Shield, healthy: 230 },
];

const CloudPage = () => {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-foreground">Cloud Resources</h1>

      {/* Provider cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {cloudResources.map((cloud) => (
          <div key={cloud.provider + cloud.region} className="rounded border border-border bg-card p-3 hover:bg-muted/30 transition-colors cursor-pointer">
            <div className="flex items-center gap-2 mb-2">
              <Cloud className="w-4 h-4 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">{cloud.provider}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{cloud.region}</div>
              </div>
            </div>
            <div className="text-2xl font-semibold font-mono text-foreground mb-2">{cloud.resources}</div>
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1 text-success"><CheckCircle className="w-3 h-3" /> {cloud.healthy}</span>
              {cloud.warnings > 0 && <span className="flex items-center gap-1 text-warning"><AlertTriangle className="w-3 h-3" /> {cloud.warnings}</span>}
              {cloud.critical > 0 && <span className="flex items-center gap-1 text-critical">{cloud.critical} crit</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Resource types */}
      <div className="rounded border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3">Resource Breakdown</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {resourceTypes.map((rt) => (
            <div key={rt.type} className="text-center p-3 rounded bg-muted/30">
              <rt.icon className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
              <div className="text-lg font-semibold font-mono text-foreground">{rt.count}</div>
              <div className="text-[10px] text-muted-foreground">{rt.type}</div>
              <div className="mt-1">
                <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-success rounded-full" style={{ width: `${(rt.healthy / rt.count) * 100}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CloudPage;
