import { Network } from "lucide-react";

const nodes = [
  { id: "lb", label: "Load Balancer", x: 50, y: 15, status: "healthy" },
  { id: "api1", label: "API-01", x: 25, y: 40, status: "healthy" },
  { id: "api2", label: "API-02", x: 50, y: 40, status: "healthy" },
  { id: "api3", label: "API-03", x: 75, y: 40, status: "warning" },
  { id: "db", label: "DB Primary", x: 35, y: 70, status: "healthy" },
  { id: "cache", label: "Redis Cache", x: 65, y: 70, status: "healthy" },
  { id: "storage", label: "Storage", x: 50, y: 90, status: "critical" },
];

const edges = [
  ["lb", "api1"], ["lb", "api2"], ["lb", "api3"],
  ["api1", "db"], ["api2", "db"], ["api2", "cache"],
  ["api3", "cache"], ["db", "storage"], ["cache", "storage"],
];

const statusColor = {
  healthy: "hsl(160, 84%, 39%)",
  warning: "hsl(38, 92%, 50%)",
  critical: "hsl(0, 84%, 60%)",
};

export function TopologyMini() {
  const getNode = (id: string) => nodes.find((n) => n.id === id)!;

  return (
    <div className="rounded border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Service Topology</h3>
        <Network className="w-4 h-4 text-muted-foreground" />
      </div>
      <svg viewBox="0 0 100 100" className="w-full h-48">
        {edges.map(([from, to], i) => {
          const a = getNode(from);
          const b = getNode(to);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="hsl(214, 32%, 91%)"
              strokeWidth={0.5}
            />
          );
        })}
        {nodes.map((node) => (
          <g key={node.id}>
            <circle
              cx={node.x}
              cy={node.y}
              r={3}
              fill={statusColor[node.status as keyof typeof statusColor]}
              className={node.status === "critical" ? "status-pulse" : ""}
            />
            <text
              x={node.x}
              y={node.y + 6}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: "3px" }}
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
