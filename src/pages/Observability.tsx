import { Activity, BarChart3, Clock, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";

const metricsData = Array.from({ length: 30 }, (_, i) => ({
  time: `${i + 1}`,
  requests: Math.floor(10000 + Math.random() * 5000),
  errors: Math.floor(50 + Math.random() * 150),
  latency: Math.floor(15 + Math.random() * 35),
}));

const Observability = () => {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-foreground">Observability</h1>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Requests/min", value: "14.2K", icon: Activity },
          { label: "Error Rate", value: "0.23%", icon: TrendingUp },
          { label: "P99 Latency", value: "142ms", icon: Clock },
          { label: "Traces Collected", value: "2.1M", icon: BarChart3 },
        ].map((m) => (
          <div key={m.label} className="rounded border border-border bg-card p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{m.label}</span>
              <m.icon className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="text-xl font-semibold font-mono text-foreground">{m.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Request Volume (30m)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={metricsData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="reqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 32%, 91%)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(215, 16%, 47%)" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(215, 16%, 47%)" tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(214,32%,91%)" }} />
              <Area type="monotone" dataKey="requests" stroke="hsl(217, 91%, 60%)" fill="url(#reqGrad)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Error Rate (30m)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={metricsData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214, 32%, 91%)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="hsl(215, 16%, 47%)" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(215, 16%, 47%)" tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid hsl(214,32%,91%)" }} />
              <Bar dataKey="errors" fill="hsl(0, 84%, 60%)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Observability;
