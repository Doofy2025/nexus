import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Server,
  Network,
  Bell,
  Zap,
  Shield,
  Smartphone,
  Cloud,
  FileText,
  Settings,
  Activity,
} from "lucide-react";

const pages = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Server, label: "Inventory", path: "/inventory" },
  { icon: Network, label: "Topology", path: "/topology" },
  { icon: Activity, label: "Observability", path: "/observability" },
  { icon: Bell, label: "Alerts", path: "/alerts" },
  { icon: Zap, label: "Automation", path: "/automation" },
  { icon: Shield, label: "Security", path: "/security" },
  { icon: Smartphone, label: "Mobile Devices", path: "/mobile" },
  { icon: Cloud, label: "Cloud Resources", path: "/cloud" },
  { icon: FileText, label: "Reports", path: "/reports" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const custom = () => setOpen(true);
    document.addEventListener("keydown", down);
    document.addEventListener("open-command", custom);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("open-command", custom);
    };
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, assets, alerts…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map((p) => (
            <CommandItem
              key={p.path}
              onSelect={() => {
                navigate(p.path);
                setOpen(false);
              }}
            >
              <p.icon className="mr-2 h-4 w-4" />
              <span>{p.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
