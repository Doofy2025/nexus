import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Filter, Download, Server, Monitor, Cloud, Container, Smartphone, ChevronRight, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

type AssetType = "all" | "server" | "vm" | "container" | "cloud" | "mobile" | "network";

const assets = [
  { id: "srv-001", name: "prod-web-01", type: "server", os: "RHEL 9.2", ip: "10.0.1.15", status: "healthy", cpu: 42, memory: 68, agent: "v2.4.1" },
  { id: "srv-002", name: "prod-web-02", type: "server", os: "RHEL 9.2", ip: "10.0.1.16", status: "healthy", cpu: 38, memory: 72, agent: "v2.4.1" },
  { id: "srv-003", name: "prod-db-01", type: "server", os: "Ubuntu 22.04", ip: "10.0.2.10", status: "warning", cpu: 78, memory: 85, agent: "v2.4.1" },
  { id: "vm-001", name: "dev-api-01", type: "vm", os: "Windows Server 2022", ip: "10.0.3.20", status: "healthy", cpu: 25, memory: 45, agent: "v2.4.0" },
  { id: "vm-002", name: "staging-worker-01", type: "vm", os: "Ubuntu 20.04", ip: "10.0.3.30", status: "healthy", cpu: 55, memory: 61, agent: "v2.4.1" },
  { id: "cnt-001", name: "k8s/prod/api-gateway-7f8b", type: "container", os: "Alpine 3.18", ip: "172.16.0.15", status: "healthy", cpu: 12, memory: 34, agent: "sidecar" },
  { id: "cnt-002", name: "k8s/prod/worker-12", type: "container", os: "Alpine 3.18", ip: "172.16.0.42", status: "critical", cpu: 98, memory: 95, agent: "sidecar" },
  { id: "cld-001", name: "aws/ec2/i-0a1b2c3d", type: "cloud", os: "Amazon Linux 2", ip: "52.12.34.56", status: "healthy", cpu: 30, memory: 52, agent: "v2.4.1" },
  { id: "cld-002", name: "azure/vm/prod-api-east", type: "cloud", os: "Windows Server 2022", ip: "20.84.12.99", status: "healthy", cpu: 45, memory: 60, agent: "v2.4.0" },
  { id: "mob-001", name: "iPhone 15 - J.Smith", type: "mobile", os: "iOS 17.4", ip: "—", status: "healthy", cpu: 0, memory: 0, agent: "MDM" },
  { id: "mob-002", name: "Galaxy S24 - T.Jones", type: "mobile", os: "Android 14", ip: "—", status: "warning", cpu: 0, memory: 0, agent: "MDM" },
  { id: "net-001", name: "core-switch-01", type: "network", os: "Cisco IOS-XE 17.9", ip: "10.0.0.1", status: "healthy", cpu: 15, memory: 40, agent: "SNMP" },
];

const statusIcon = {
  healthy: <CheckCircle className="w-3.5 h-3.5 text-success" />,
  warning: <AlertTriangle className="w-3.5 h-3.5 text-warning" />,
  critical: <XCircle className="w-3.5 h-3.5 text-critical" />,
};

const typeFilters: { value: AssetType; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "All", icon: Server },
  { value: "server", label: "Servers", icon: Server },
  { value: "vm", label: "VMs", icon: Monitor },
  { value: "container", label: "Containers", icon: Container },
  { value: "cloud", label: "Cloud", icon: Cloud },
  { value: "mobile", label: "Mobile", icon: Smartphone },
];

const Inventory = () => {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetType>("all");
  const navigate = useNavigate();

  const filtered = assets.filter((a) => {
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.ip.includes(search)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Asset Inventory</h1>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded hover:bg-muted transition-colors">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search assets by name or IP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-1">
          {typeFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded transition-colors ${
                typeFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <f.icon className="w-3 h-3" />
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Name</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Type</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">OS</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">IP Address</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">CPU</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Memory</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Agent</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((asset) => (
              <tr key={asset.id} onClick={() => navigate(`/asset/${asset.id}`)} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer">
                <td className="px-3 py-2">{statusIcon[asset.status as keyof typeof statusIcon]}</td>
                <td className="px-3 py-2 font-mono text-xs font-medium text-foreground">{asset.name}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground capitalize">{asset.type}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{asset.os}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{asset.ip}</td>
                <td className="px-3 py-2">
                  {asset.cpu > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${asset.cpu > 80 ? "bg-critical" : asset.cpu > 60 ? "bg-warning" : "bg-success"}`} style={{ width: `${asset.cpu}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">{asset.cpu}%</span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {asset.memory > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${asset.memory > 80 ? "bg-critical" : asset.memory > 60 ? "bg-warning" : "bg-success"}`} style={{ width: `${asset.memory}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">{asset.memory}%</span>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{asset.agent}</td>
                <td className="px-3 py-2">
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-muted-foreground">Showing {filtered.length} of {assets.length} assets</div>
    </div>
  );
};

export default Inventory;
