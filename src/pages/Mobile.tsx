import { Smartphone, Battery, Wifi, Shield, MapPin, CheckCircle, AlertTriangle, XCircle, Clock, Search } from "lucide-react";
import { useState } from "react";

const devices = [
  { id: "mob-001", name: "iPhone 15 Pro", user: "J. Smith", os: "iOS 17.4", status: "compliant", battery: 82, connectivity: "WiFi", mdm: "Intune", lastCheckin: "3m ago", location: "Building A, Floor 3", apps: "All installed" },
  { id: "mob-002", name: "Galaxy S24 Ultra", user: "T. Jones", os: "Android 14", status: "non-compliant", battery: 45, connectivity: "5G", mdm: "Intune", lastCheckin: "15m ago", location: "Remote", apps: "Missing: Authenticator" },
  { id: "mob-003", name: "iPhone 14", user: "A. Williams", os: "iOS 17.3", status: "compliant", battery: 91, connectivity: "WiFi", mdm: "Intune", lastCheckin: "1m ago", location: "Building B, Floor 1", apps: "All installed" },
  { id: "mob-004", name: "Pixel 8 Pro", user: "M. Davis", os: "Android 14", status: "compliant", battery: 67, connectivity: "LTE", mdm: "Intune", lastCheckin: "8m ago", location: "Building A, Floor 2", apps: "All installed" },
  { id: "mob-005", name: "iPad Pro 12.9", user: "R. Chen", os: "iPadOS 17.4", status: "compliant", battery: 100, connectivity: "WiFi", mdm: "Intune", lastCheckin: "2m ago", location: "Conference Room C", apps: "All installed" },
  { id: "mob-006", name: "Galaxy A54", user: "K. Patel", os: "Android 13", status: "non-compliant", battery: 12, connectivity: "Offline", mdm: "Not enrolled", lastCheckin: "3d ago", location: "Unknown", apps: "Not verified" },
];

const Mobile = () => {
  const [search, setSearch] = useState("");
  const filtered = devices.filter((d) =>
    !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.user.toLowerCase().includes(search.toLowerCase())
  );

  const compliant = devices.filter((d) => d.status === "compliant").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Mobile Device Management</h1>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-success/10 text-success font-medium">{compliant}/{devices.length} Compliant</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Total Devices</div>
          <div className="text-xl font-semibold font-mono text-foreground">{devices.length}</div>
        </div>
        <div className="rounded border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">MDM Enrolled</div>
          <div className="text-xl font-semibold font-mono text-foreground">{devices.filter((d) => d.mdm !== "Not enrolled").length}</div>
        </div>
        <div className="rounded border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Online Now</div>
          <div className="text-xl font-semibold font-mono text-success">{devices.filter((d) => d.connectivity !== "Offline").length}</div>
        </div>
        <div className="rounded border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground mb-1">Compliance Rate</div>
          <div className="text-xl font-semibold font-mono text-foreground">{Math.round((compliant / devices.length) * 100)}%</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search devices or users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Device cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((device) => (
          <div key={device.id} className="rounded border border-border bg-card p-3 hover:bg-muted/30 transition-colors cursor-pointer">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium text-foreground">{device.name}</div>
                  <div className="text-xs text-muted-foreground">{device.user}</div>
                </div>
              </div>
              {device.status === "compliant" ? (
                <CheckCircle className="w-4 h-4 text-success" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-warning" />
              )}
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>OS</span><span className="font-mono">{device.os}</span></div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1"><Battery className="w-3 h-3" /> Battery</span>
                <span className={`font-mono ${device.battery < 20 ? "text-critical" : ""}`}>{device.battery}%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1"><Wifi className="w-3 h-3" /> Network</span>
                <span className={`font-mono ${device.connectivity === "Offline" ? "text-critical" : ""}`}>{device.connectivity}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> MDM</span>
                <span className={`font-mono ${device.mdm === "Not enrolled" ? "text-critical" : ""}`}>{device.mdm}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Last Check-in</span>
                <span className="font-mono">{device.lastCheckin}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</span>
                <span className="font-mono text-right max-w-32 truncate">{device.location}</span>
              </div>
            </div>
            {device.apps !== "All installed" && (
              <div className="mt-2 px-2 py-1 rounded bg-warning/10 text-warning text-[10px]">{device.apps}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Mobile;
