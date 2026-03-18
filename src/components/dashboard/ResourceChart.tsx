import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const data = Array.from({ length: 24 }, (_, i) => ({
  time: `${i}:00`,
  cpu: Math.floor(35 + Math.random() * 30 + (i > 8 && i < 18 ? 15 : 0)),
  memory: Math.floor(55 + Math.random() * 20 + (i > 10 && i < 16 ? 10 : 0)),
  network: Math.floor(20 + Math.random() * 25 + (i > 9 && i < 17 ? 20 : 0)),
}));

export function ResourceChart() {
  return (
    <div className="rounded border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Infrastructure Utilization (24h)</h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" /> CPU</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> Memory</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> Network</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(160, 84%, 39%)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(160, 84%, 39%)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 32%, 91%)" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(215, 16%, 47%)" tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(215, 16%, 47%)" tickLine={false} axisLine={false} unit="%" />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(214,32%,91%)" }}
          />
          <Area type="monotone" dataKey="cpu" stroke="hsl(217, 91%, 60%)" fill="url(#cpuGrad)" strokeWidth={1.5} />
          <Area type="monotone" dataKey="memory" stroke="hsl(160, 84%, 39%)" fill="url(#memGrad)" strokeWidth={1.5} />
          <Area type="monotone" dataKey="network" stroke="hsl(38, 92%, 50%)" fill="url(#netGrad)" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
