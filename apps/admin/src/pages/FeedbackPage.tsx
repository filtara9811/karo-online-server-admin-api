import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ExternalLink, MessageSquareWarning } from "lucide-react";
import { apiFetch, asList, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldCard, PageHeader } from "@/components/admin/AdminLayout";

type Row = {
  id: string;
  user_id: string | null;
  reporter_role: string;
  page_path: string | null;
  page_title: string | null;
  message: string;
  screenshot_url: string | null;
  status: string;
  created_at: string;
};

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "user", label: "User-Reported" },
  { key: "vendor", label: "Vendor-Reported" },
  { key: "technical", label: "Technical / Marketplace" },
];

export default function FeedbackPage() {
  const [tab, setTab] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");

  const q = useQuery({
    queryKey: ["admin-table", "feedback_reports"],
    queryFn: async () =>
      asList(await apiFetch("/v1/admin/table/feedback_reports")).map(
        (r): Row => ({
          id: str(r.id),
          user_id: r.user_id == null ? null : str(r.user_id),
          reporter_role: str(r.reporter_role, "user"),
          page_path: r.page_path == null ? null : str(r.page_path),
          page_title: r.page_title == null ? null : str(r.page_title),
          message: str(r.message),
          screenshot_url: r.screenshot_url == null ? null : str(r.screenshot_url),
          status: str(r.status, "open"),
          created_at: str(r.created_at),
        }),
      ),
  });

  const rows = q.data ?? [];
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (tab !== "all" && r.reporter_role !== tab) return false;
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        return true;
      }),
    [rows, tab, statusFilter],
  );

  return (
    <>
      <PageHeader title="💬 Feedback / Support" subtitle="User, vendor aur technical reports" />

      <div className="flex flex-wrap gap-2 mb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-bold ${
              tab === t.key ? "bg-[#d4af37] text-black" : "bg-white/5 text-[#f5d97a]/80"
            }`}
          >
            {t.label}
          </button>
        ))}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="ml-auto px-3 py-1.5 rounded-full bg-black/40 border border-[#d4af37]/30 text-[#f5d97a] text-xs"
        >
          <option value="all">All status</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {q.isError && (
        <div className="mb-4">
          <ErrorBanner
            message={q.error instanceof Error ? q.error.message : "Feedback load fail"}
            onRetry={() => q.refetch()}
          />
        </div>
      )}

      {q.isLoading ? (
        <GoldCard className="p-16 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </GoldCard>
      ) : filtered.length === 0 ? (
        <GoldCard className="p-12 text-center">
          <MessageSquareWarning className="h-10 w-10 text-[#d4af37]/40 mx-auto mb-3" />
          <p className="text-[#f5d97a]/60 text-sm">Koi feedback nahi mila.</p>
        </GoldCard>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <GoldCard key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[#fff8dc] whitespace-pre-wrap">{r.message}</p>
                  <p className="text-[11px] text-[#f5d97a]/60 mt-1">
                    {r.reporter_role} · {r.page_title || r.page_path || "—"} ·{" "}
                    {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                  </p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#d4af37]/20 text-[#d4af37] font-bold uppercase shrink-0">
                  {r.status}
                </span>
              </div>
              {r.screenshot_url && (
                <a
                  href={r.screenshot_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-[11px] text-[#f5d97a]"
                >
                  <ExternalLink className="h-3 w-3" /> Screenshot
                </a>
              )}
            </GoldCard>
          ))}
        </div>
      )}
    </>
  );
}
