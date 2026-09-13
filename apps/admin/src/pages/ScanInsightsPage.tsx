import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ScanLine } from "lucide-react";
import { apiFetch, num, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldCard, PageHeader } from "@/components/admin/AdminLayout";

type Insights = {
  total: number;
  last7d: number;
  last30d: number;
  today: number;
  avgConfidence: number | null;
  emptyRate: number;
  fieldFillRate: Record<string, number>;
  recent: { id: string; created_at: string; business_name: string | null; mobile: string | null; confidence: number | null }[];
};

export default function ScanInsightsPage() {
  const q = useQuery({
    queryKey: ["scan-insights"],
    queryFn: () => apiFetch<Insights>("/v1/admin/scan-insights"),
  });
  const d = q.data;

  return (
    <>
      <PageHeader title="Scan insights" subtitle="OCR field confidence from vendor visiting-card scans" />
      {q.error && <ErrorBanner message={q.error instanceof Error ? q.error.message : "Load fail"} onRetry={() => q.refetch()} />}
      {q.isLoading ? (
        <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" /></div>
      ) : d ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Total scans" value={d.total} />
            <Stat label="Today" value={d.today} />
            <Stat label="7 days" value={d.last7d} />
            <Stat label="30 days" value={d.last30d} />
            <Stat label="Avg confidence" value={Math.round((d.avgConfidence ?? 0) * 100)} suffix="%" />
          </div>
          <GoldCard className="p-5">
            <h3 className="font-display font-bold text-[#fff8dc] mb-3">Field fill rate</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {Object.entries(d.fieldFillRate ?? {}).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm border border-[#d4af37]/20 rounded-xl px-3 py-2">
                  <span className="text-[#f5d97a]/80">{k}</span>
                  <span className="text-[#fff8dc]">{Math.round(v * 100)}%</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#f5d97a]/50 mt-3">Empty extract rate {Math.round((d.emptyRate ?? 0) * 100)}%</p>
          </GoldCard>
          <GoldCard className="p-5">
            <h3 className="font-display font-bold text-[#fff8dc] mb-3">Recent</h3>
            <ul className="space-y-2">
              {(d.recent ?? []).map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-xl border border-[#d4af37]/20 px-3 py-2">
                  <ScanLine className="h-4 w-4 text-[#d4af37]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[#fff8dc] truncate">{r.business_name || "Unknown shop"}</p>
                    <p className="text-[11px] text-[#f5d97a]/60">{r.mobile || "—"} · {str(r.created_at)}</p>
                  </div>
                  <span className="text-xs text-[#f5d97a]">{Math.round(num(r.confidence) * 100)}%</span>
                </li>
              ))}
            </ul>
          </GoldCard>
          <Link to="/vendors" className="text-[#f5d97a] text-sm">← Vendors</Link>
        </div>
      ) : null}
    </>
  );
}

function Stat({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <GoldCard className="p-4">
      <p className="text-2xl font-extrabold text-[#fff8dc]">{value}{suffix}</p>
      <p className="text-[10px] uppercase tracking-[0.2em] text-[#f5d97a]/60 mt-1.5">{label}</p>
    </GoldCard>
  );
}
