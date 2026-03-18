import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Container,
  Monitor,
  Server,
  Cpu,
  Cloud,
  Download,
  Copy,
  CheckCircle2,
  Settings,
  RefreshCw,
  Shield,
  Key,
  FolderOpen,
  Terminal,
  Upload,
} from "lucide-react";

/* ── Agent platform configs ── */
interface PlatformConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  installCmd: string;
  fileExt: string;
  notes: string;
}

const platforms: PlatformConfig[] = [
  {
    id: "podman",
    label: "Podman Container",
    icon: Container,
    installCmd: `podman pull registry.vanguardos.io/agent:latest
podman run -d --name vanguard-agent \\
  -e AGENT_KEY=<YOUR_KEY> \\
  -e SITE_CODE=<SITE> \\
  -v /var/run/vanguard:/data \\
  --restart=always \\
  registry.vanguardos.io/agent:latest`,
    fileExt: "",
    notes: "Requires Podman 4.0+. Rootless mode supported.",
  },
  {
    id: "windows",
    label: "Windows",
    icon: Monitor,
    installCmd: `# PowerShell (Run as Administrator)
Invoke-WebRequest -Uri "https://dl.vanguardos.io/agent/latest/vanguard-agent-setup.exe" -OutFile "$env:TEMP\\vanguard-agent-setup.exe"
Start-Process "$env:TEMP\\vanguard-agent-setup.exe" -ArgumentList "/S /AGENT_KEY=<YOUR_KEY> /SITE=<SITE>" -Wait`,
    fileExt: ".exe",
    notes: "Supports Windows Server 2016+ and Windows 10/11. Installs as a Windows Service.",
  },
  {
    id: "rhel",
    label: "RHEL / CentOS",
    icon: Server,
    installCmd: `# Add Vanguard repo
sudo rpm --import https://dl.vanguardos.io/keys/RPM-GPG-KEY-vanguard
sudo curl -o /etc/yum.repos.d/vanguard.repo https://dl.vanguardos.io/repo/vanguard.repo

# Install & configure
sudo dnf install -y vanguard-agent
sudo vanguard-agent configure --key <YOUR_KEY> --site <SITE>
sudo systemctl enable --now vanguard-agent`,
    fileExt: ".rpm",
    notes: "Supports RHEL/CentOS 7, 8, 9. SELinux policies included.",
  },
  {
    id: "aix",
    label: "IBM AIX",
    icon: Cpu,
    installCmd: `# Download AIX package
curl -O https://dl.vanguardos.io/agent/latest/vanguard-agent.aix.bff

# Install
installp -aXYgd vanguard-agent.aix.bff vanguard.agent

# Configure
/opt/vanguard/bin/vanguard-agent configure --key <YOUR_KEY> --site <SITE>
startsrc -s vanguard-agent`,
    fileExt: ".bff",
    notes: "Supports AIX 7.2+. Requires root. Uses SRC for service management.",
  },
];

/* ── Cloud collector configs ── */
interface CloudProvider {
  id: string;
  label: string;
  color: string;
  fields: { key: string; label: string; placeholder: string; secret?: boolean }[];
}

const cloudProviders: CloudProvider[] = [
  {
    id: "aws",
    label: "Amazon Web Services",
    color: "bg-warning/10 text-warning",
    fields: [
      { key: "accessKeyId", label: "Access Key ID", placeholder: "AKIA..." },
      { key: "secretAccessKey", label: "Secret Access Key", placeholder: "••••••••", secret: true },
      { key: "region", label: "Default Region", placeholder: "us-east-1" },
      { key: "assumeRoleArn", label: "Assume Role ARN (optional)", placeholder: "arn:aws:iam::123456:role/VanguardCollector" },
    ],
  },
  {
    id: "azure",
    label: "Microsoft Azure",
    color: "bg-primary/10 text-primary",
    fields: [
      { key: "tenantId", label: "Tenant ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "clientId", label: "App (Client) ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "clientSecret", label: "Client Secret", placeholder: "••••••••", secret: true },
      { key: "subscriptionId", label: "Subscription ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    ],
  },
  {
    id: "gcp",
    label: "Google Cloud Platform",
    color: "bg-success/10 text-success",
    fields: [
      { key: "projectId", label: "Project ID", placeholder: "my-project-123" },
      { key: "serviceAccountJson", label: "Service Account Key (JSON)", placeholder: "Paste JSON key contents…" },
      { key: "region", label: "Default Region", placeholder: "us-central1" },
    ],
  },
];

/* ── AnyDesk post-install script ── */
const anydeskScript = `#!/bin/bash
# Vanguard AnyDesk Auto-Deploy Script
# Installs AnyDesk, launches it, captures the ID, and reports back.

AGENT_ENDPOINT="https://api.vanguardos.io/v1/agents/anydesk-register"

echo "[Vanguard] Installing AnyDesk client..."
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  start /wait AnyDesk.exe --install --silent
elif command -v rpm &>/dev/null; then
  sudo rpm -i anydesk.rpm
else
  sudo dpkg -i anydesk.deb
fi

echo "[Vanguard] Starting AnyDesk and capturing ID..."
sleep 3
ANYDESK_ID=$(anydesk --get-id 2>/dev/null)

if [ -z "$ANYDESK_ID" ]; then
  echo "[Vanguard] ERROR: Could not retrieve AnyDesk ID."
  exit 1
fi

echo "[Vanguard] AnyDesk ID: $ANYDESK_ID"
echo "[Vanguard] Reporting ID back to Vanguard platform..."

curl -s -X POST "$AGENT_ENDPOINT" \\
  -H "Authorization: Bearer <AGENT_KEY>" \\
  -H "Content-Type: application/json" \\
  -d "{\\"agent_id\\": \\"$(hostname)\\", \\"anydesk_id\\": \\"$ANYDESK_ID\\", \\"site\\": \\"<SITE>\\"}"

echo "[Vanguard] AnyDesk registered successfully."`;

/* ── Component ── */
export default function AgentDeployment() {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [bundleAnyDesk, setBundleAnyDesk] = useState<Record<string, boolean>>({});
  const [collectorStates, setCollectorStates] = useState<Record<string, boolean>>({
    aws: false,
    azure: false,
    gcp: false,
  });
  const [collectorFields, setCollectorFields] = useState<Record<string, Record<string, string>>>({
    aws: {},
    azure: {},
    gcp: {},
  });

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const updateField = (provider: string, field: string, value: string) => {
    setCollectorFields((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], [field]: value },
    }));
  };

  const toggleCollector = (provider: string) => {
    setCollectorStates((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agent Deployment</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Deploy monitoring agents to your infrastructure or configure cloud collectors.
        </p>
      </div>

      <Tabs defaultValue="agents" className="space-y-4">
        <TabsList>
          <TabsTrigger value="agents" className="gap-1.5">
            <Download className="w-3.5 h-3.5" />
            Agent Install
          </TabsTrigger>
          <TabsTrigger value="cloud" className="gap-1.5">
            <Cloud className="w-3.5 h-3.5" />
            Cloud Collectors
          </TabsTrigger>
        </TabsList>

        {/* ═══ Agent Install Tab ═══ */}
        <TabsContent value="agents" className="space-y-4">
          <Card className="p-4 border-border bg-card">
            <div className="flex items-center gap-3 mb-4">
              <Key className="w-5 h-5 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">Agent Registration Key</div>
                <p className="text-xs text-muted-foreground">
                  Use this key when configuring new agents. Rotate if compromised.
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <code className="bg-muted text-foreground font-mono text-xs px-3 py-1.5 rounded">
                  vgd_ak_7f3a9b2c1d4e5f6a8b9c0d1e2f3a4b5c
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard("vgd_ak_7f3a9b2c1d4e5f6a8b9c0d1e2f3a4b5c", "key")}
                >
                  {copiedCmd === "key" ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
                <Button variant="outline" size="sm">
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Rotate
                </Button>
              </div>
            </div>
          </Card>

          <Tabs defaultValue="podman">
            <TabsList>
              {platforms.map((p) => (
                <TabsTrigger key={p.id} value={p.id} className="gap-1.5">
                  <p.icon className="w-3.5 h-3.5" />
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {platforms.map((platform) => (
              <TabsContent key={platform.id} value={platform.id} className="space-y-4 mt-4">
                <Card className="p-5 border-border bg-card space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <platform.icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-foreground">{platform.label}</h3>
                        <p className="text-xs text-muted-foreground">{platform.notes}</p>
                      </div>
                    </div>
                    {platform.fileExt && (
                      <Button size="sm">
                        <Download className="w-3.5 h-3.5 mr-1" />
                        Download {platform.fileExt}
                      </Button>
                    )}
                  </div>

                  <div className="relative">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground">Installation Commands</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => copyToClipboard(platform.installCmd, platform.id)}
                      >
                        {copiedCmd === platform.id ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 mr-1 text-success" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 mr-1" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="bg-sidebar text-sidebar-foreground font-mono text-xs p-4 rounded-lg overflow-x-auto leading-relaxed">
                      {platform.installCmd}
                    </pre>
                  </div>

                  <div className="grid grid-cols-3 gap-4 pt-2">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Assign to Site</label>
                      <Input placeholder="e.g. ADC, SDC, AWS-US-EAST" className="text-sm" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Agent Tags (comma-separated)</label>
                      <Input placeholder="e.g. production, web-tier" className="text-sm" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Bundle AnyDesk</label>
                      <div className="flex items-center gap-3 h-10">
                        <Switch
                          checked={bundleAnyDesk[platform.id] || false}
                          onCheckedChange={() => setBundleAnyDesk(prev => ({ ...prev, [platform.id]: !prev[platform.id] }))}
                        />
                        <span className="text-xs text-muted-foreground">Package AnyDesk remote access with agent</span>
                      </div>
                    </div>
                  </div>

                  {bundleAnyDesk[platform.id] && (
                    <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/30">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <FolderOpen className="w-4 h-4 text-primary" />
                        AnyDesk Bundle Configuration
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="border border-dashed border-border rounded-lg p-4 flex flex-col items-center justify-center gap-2 bg-background min-h-[100px]">
                          <Upload className="w-6 h-6 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground text-center">
                            Drop AnyDesk installer here or click to browse
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Expected: {platform.id === "windows" ? "AnyDesk.exe" : platform.id === "rhel" ? "anydesk.rpm" : platform.id === "aix" ? "anydesk.bff" : "anydesk binary"}
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-1">
                            Source folder: <code className="bg-muted px-1 rounded">public/agent-bundles/anydesk/</code>
                          </span>
                          <Button variant="outline" size="sm" className="mt-1">
                            <Upload className="w-3 h-3 mr-1" />
                            Select File
                          </Button>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <label className="text-xs font-medium text-muted-foreground block mb-1">AnyDesk Password Policy</label>
                            <Input placeholder="Auto-generated secure password" className="text-sm" />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-muted-foreground block mb-1">Access Profile</label>
                            <Input placeholder="e.g. unattended-full-access" className="text-sm" />
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch defaultChecked />
                            <span className="text-xs text-muted-foreground">Auto-report AnyDesk ID back to platform</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium text-muted-foreground">Post-Install Script (installs AnyDesk, captures ID, reports back)</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => copyToClipboard(anydeskScript, `anydesk-${platform.id}`)}
                          >
                            {copiedCmd === `anydesk-${platform.id}` ? (
                              <>
                                <CheckCircle2 className="w-3 h-3 mr-1 text-success" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3 mr-1" />
                                Copy Script
                              </>
                            )}
                          </Button>
                        </div>
                        <pre className="bg-sidebar text-sidebar-foreground font-mono text-[11px] p-4 rounded-lg overflow-x-auto leading-relaxed max-h-48 overflow-y-auto">
                          {anydeskScript}
                        </pre>
                      </div>
                    </div>
                  )}
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>

        {/* ═══ Cloud Collectors Tab ═══ */}
        <TabsContent value="cloud" className="space-y-4">
          <Card className="p-4 border-border bg-card">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">Cloud Collector Service</div>
                <p className="text-xs text-muted-foreground">
                  Configure credentials and enable collectors to pull metrics, inventory, and cost data from your cloud accounts.
                </p>
              </div>
            </div>
          </Card>

          {cloudProviders.map((provider) => (
            <Card key={provider.id} className="border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={provider.color}>
                    {provider.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {collectorStates[provider.id] ? "Collector running" : "Disabled"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {collectorStates[provider.id] ? "Enabled" : "Disabled"}
                  </span>
                  <Switch
                    checked={collectorStates[provider.id]}
                    onCheckedChange={() => toggleCollector(provider.id)}
                  />
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {provider.fields.map((field) => (
                    <div key={field.key}>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">{field.label}</label>
                      <Input
                        type={field.secret ? "password" : "text"}
                        placeholder={field.placeholder}
                        value={collectorFields[provider.id]?.[field.key] || ""}
                        onChange={(e) => updateField(provider.id, field.key, e.target.value)}
                        className="text-sm font-mono"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-4 pt-2 border-t border-border">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">Poll Interval</label>
                    <Input
                      defaultValue="300"
                      className="w-20 text-sm text-center"
                    />
                    <span className="text-xs text-muted-foreground">seconds</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch defaultChecked />
                    <label className="text-xs text-muted-foreground">Collect Cost Data</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch defaultChecked />
                    <label className="text-xs text-muted-foreground">Collect Inventory</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch defaultChecked />
                    <label className="text-xs text-muted-foreground">Collect Metrics</label>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <Button variant="outline" size="sm">
                      <Settings className="w-3.5 h-3.5 mr-1" />
                      Test Connection
                    </Button>
                    <Button size="sm">Save</Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
