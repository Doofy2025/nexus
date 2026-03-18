import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { ArrowLeft, Cpu, MemoryStick, HardDrive, Network, Activity, Server, Box, AppWindow, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

// All known assets across the system
const allAssets: Record<string, { name: string; type: string; os: string; ip: string; status: "healthy" | "warning" | "critical"; site: string }> = {
  "srv-001": { name: "prod-web-01", type: "server", os: "RHEL 9.2", ip: "10.0.1.15", status: "healthy", site: "ADC" },
  "srv-002": { name: "prod-web-02", type: "server", os: "RHEL 9.2", ip: "10.0.1.16", status: "healthy", site: "ADC" },
  "srv-003": { name: "prod-db-01", type: "server", os: "Ubuntu 22.04", ip: "10.0.2.10", status: "warning", site: "ADC" },
  "srv-004": { name: "dr-web-01", type: "server", os: "RHEL 9.2", ip: "10.1.1.15", status: "healthy", site: "SDC" },
  "srv-005": { name: "dr-db-01", type: "server", os: "Ubuntu 22.04", ip: "10.1.2.10", status: "healthy", site: "SDC" },
  "vm-001": { name: "dev-api-01", type: "vm", os: "Windows Server 2022", ip: "10.0.3.20", status: "healthy", site: "LDC-ANNEX" },
  "vm-002": { name: "staging-worker-01", type: "vm", os: "Ubuntu 20.04", ip: "10.0.3.30", status: "healthy", site: "LDC-MOPAC" },
  "cnt-001": { name: "k8s/prod/api-gateway-7f8b", type: "container", os: "Alpine 3.18", ip: "172.16.0.15", status: "healthy", site: "AWS" },
  "cnt-002": { name: "k8s/prod/worker-12", type: "container", os: "Alpine 3.18", ip: "172.16.0.42", status: "critical", site: "AWS" },
  "cld-001": { name: "aws/ec2/i-0a1b2c3d", type: "cloud", os: "Amazon Linux 2", ip: "52.12.34.56", status: "healthy", site: "AWS" },
  "cld-002": { name: "azure/vm/prod-api-east", type: "cloud", os: "Windows Server 2022", ip: "20.84.12.99", status: "healthy", site: "AZURE" },
  "cld-003": { name: "gcp/gce/web-pool-1", type: "cloud", os: "Debian 12", ip: "34.120.55.10", status: "healthy", site: "GCP" },
  "mob-001": { name: "iPhone 15 - J.Smith", type: "mobile", os: "iOS 17.4", ip: "—", status: "healthy", site: "LDC-MOPAC" },
  "mob-002": { name: "Galaxy S24 - T.Jones", type: "mobile", os: "Android 14", ip: "—", status: "warning", site: "LDC-MOPAC" },
  "net-001": { name: "core-switch-01", type: "network", os: "Cisco IOS-XE 17.9", ip: "10.0.0.1", status: "healthy", site: "ADC" },
};

const services = [
  { name: "sshd", status: "running", pid: 1024 },
  { name: "nginx", status: "running", pid: 2048 },
  { name: "postgresql", status: "running", pid: 3072 },
  { name: "prometheus-node-exporter", status: "running", pid: 4096 },
  { name: "crond", status: "running", pid: 512 },
  { name: "rsyslog", status: "running", pid: 768 },
  { name: "firewalld", status: "running", pid: 256 },
  { name: "docker", status: "running", pid: 5120 },
];

const applications = [
  { name: "Nginx", version: "1.24.0", type: "Web Server" },
  { name: "PostgreSQL", version: "15.4", type: "Database" },
  { name: "Docker", version: "24.0.7", type: "Container Runtime" },
  { name: "Node.js", version: "20.11.0", type: "Runtime" },
  { name: "Prometheus Exporter", version: "1.7.0", type: "Monitoring" },
  { name: "Grafana Agent", version: "0.38.1", type: "Monitoring" },
  { name: "OpenSSH", version: "9.5p1", type: "Remote Access" },
  { name: "Fail2Ban", version: "1.0.2", type: "Security" },
];

const statusBadge = {
  healthy: <span className="flex items-center gap-1 text-xs text-success"><CheckCircle className="w-3 h-3" /> Healthy</span>,
  warning: <span className="flex items-center gap-1 text-xs text-warning"><AlertTriangle className="w-3 h-3" /> Warning</span>,
  critical: <span className="flex items-center gap-1 text-xs text-critical"><XCircle className="w-3 h-3" /> Critical</span>,
};

// Simulated real-time gauge
function useSimulatedMetric(base: number, variance: number = 5) {
  const [value, setValue] = useState(base);
  useEffect(() => {
    const interval = setInterval(() => {
      setValue(Math.max(0, Math.min(100, base + (Math.random() - 0.5) * variance * 2)));
    }, 2000);
    return () => clearInterval(interval);
  }, [base, variance]);
  return Math.round(value * 10) / 10;
}

function MetricGauge({ label, value, unit, icon: Icon, color }: { label: string; value: number; unit: string; icon: React.ElementType; color: string }) {
  const barColor = value > 80 ? "bg-critical" : value > 60 ? "bg-warning" : `bg-${color}`;
  return (
    <div className="p-3 rounded-lg border border-border bg-card space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-2xl font-bold font-mono text-foreground">{value}<span className="text-sm text-muted-foreground ml-0.5">{unit}</span></div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-1000 ${barColor}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function IOMetric({ label, read, write }: { label: string; read: string; write: string }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card space-y-1.5">
      <div className="text-xs text-muted-foreground font-medium">{label}</div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] text-muted-foreground">Read</div>
          <div className="text-sm font-mono font-bold text-foreground">{read}</div>
        </div>
        <div className="h-6 w-px bg-border" />
        <div>
          <div className="text-[10px] text-muted-foreground">Write</div>
          <div className="text-sm font-mono font-bold text-foreground">{write}</div>
        </div>
      </div>
    </div>
  );
}

const AssetDetail = () => {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();

  const asset = allAssets[assetId || ""];

  const cpu = useSimulatedMetric(asset ? (asset.status === "critical" ? 95 : asset.status === "warning" ? 75 : 40) : 0, 5);
  const memory = useSimulatedMetric(asset ? (asset.status === "critical" ? 92 : asset.status === "warning" ? 82 : 65) : 0, 3);
  const ssdUsage = useSimulatedMetric(55, 1);
  const hddUsage = useSimulatedMetric(38, 0.5);
  const netIn = useSimulatedMetric(340, 50);
  const netOut = useSimulatedMetric(120, 30);
  const iops = useSimulatedMetric(1250, 200);

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-muted-foreground">Asset not found</p>
        <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">← Go back</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded hover:bg-muted transition-colors">
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground font-mono">{asset.name}</h1>
            {statusBadge[asset.status]}
          </div>
          <p className="text-xs text-muted-foreground">{asset.os} • {asset.ip} • {asset.type} • Site: {asset.site}</p>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-xs text-muted-foreground">
          <Activity className="w-3 h-3 text-success animate-pulse" /> Live
        </div>
      </div>

      {/* Primary I/O Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricGauge label="CPU Usage" value={cpu} unit="%" icon={Cpu} color="success" />
        <MetricGauge label="Memory Usage" value={memory} unit="%" icon={MemoryStick} color="success" />
        <MetricGauge label="SSD Usage" value={ssdUsage} unit="%" icon={HardDrive} color="primary" />
        <MetricGauge label="HDD Usage" value={hddUsage} unit="%" icon={HardDrive} color="primary" />
      </div>

      {/* Network & IOPS */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg border border-border bg-card space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Network className="w-3.5 h-3.5" /> Network In
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">{netIn}<span className="text-sm text-muted-foreground ml-0.5">Mbps</span></div>
        </div>
        <div className="p-3 rounded-lg border border-border bg-card space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Network className="w-3.5 h-3.5" /> Network Out
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">{netOut}<span className="text-sm text-muted-foreground ml-0.5">Mbps</span></div>
        </div>
        <div className="p-3 rounded-lg border border-border bg-card space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="w-3.5 h-3.5" /> IOPS
          </div>
          <div className="text-2xl font-bold font-mono text-foreground">{iops}<span className="text-sm text-muted-foreground ml-0.5">/s</span></div>
        </div>
      </div>

      {/* Disk I/O */}
      <div className="grid grid-cols-2 gap-3">
        <IOMetric label="SSD I/O" read="245 MB/s" write="180 MB/s" />
        <IOMetric label="HDD I/O" read="120 MB/s" write="85 MB/s" />
      </div>

      {/* Services & Applications */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Services */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/30">
            <Box className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Services ({services.length})</span>
          </div>
          <div className="divide-y divide-border">
            {services.map(svc => (
              <div key={svc.name} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-success" />
                  <span className="text-xs font-mono text-foreground">{svc.name}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span>PID {svc.pid}</span>
                  <span className="text-success font-medium">{svc.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Applications */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/30">
            <AppWindow className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Applications ({applications.length})</span>
          </div>
          <div className="divide-y divide-border">
            {applications.map(app => (
              <div key={app.name} className="flex items-center justify-between px-3 py-2">
                <div>
                  <span className="text-xs font-medium text-foreground">{app.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{app.type}</span>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">v{app.version}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssetDetail;
