import { FileText, Download, Calendar, BarChart3 } from "lucide-react";

const reports = [
  { name: "Weekly Infrastructure Summary", generated: "Mar 15, 2026", type: "Executive", pages: 12 },
  { name: "Monthly Compliance Report", generated: "Mar 1, 2026", type: "Compliance", pages: 34 },
  { name: "Incident Response Analysis", generated: "Mar 14, 2026", type: "Technical", pages: 8 },
  { name: "Capacity Planning Forecast", generated: "Mar 10, 2026", type: "Planning", pages: 15 },
  { name: "Security Posture Assessment", generated: "Mar 12, 2026", type: "Security", pages: 28 },
  { name: "SLA Performance Report", generated: "Mar 1, 2026", type: "Executive", pages: 6 },
];

const Reports = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Reports & Analytics</h1>
        <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity">
          <BarChart3 className="w-3.5 h-3.5" /> Generate Report
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {reports.map((report, i) => (
          <div key={i} className="rounded border border-border bg-card p-4 hover:bg-muted/30 transition-colors cursor-pointer">
            <div className="flex items-start justify-between mb-3">
              <FileText className="w-5 h-5 text-primary" />
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{report.type}</span>
            </div>
            <div className="text-sm font-medium text-foreground mb-1">{report.name}</div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {report.generated}</span>
              <span>{report.pages} pages</span>
            </div>
            <button className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline">
              <Download className="w-3 h-3" /> Download PDF
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Reports;
