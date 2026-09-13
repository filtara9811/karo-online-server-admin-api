import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio, Store, AlertTriangle, RefreshCw, Loader2, X, MapPin, Phone } from "lucide-react";
import { apiFetch, asList, bool, num, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader } from "@/components/admin/AdminLayout";

type Notif = {
  vendor_id: string;
  status: string;
  vendor_note: string | null;
  responded_at: string | null;
};

type LeadRow = {
  id: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  sub_category_name: string;
  item_names: string[];
  note: string | null;
  images: string[];
  address: string | null;
  group_name: string | null;
  status: string;
  is_marketplace: boolean;
  marketplace_reason: string | null;
  marketplace_at: string | null;
  accepted_count: number;
  max_slots: number;
  accepted_vendor_ids: string[];
  created_at: string;
  notifications: Notif[];
  pending_count: number;
  rejected_count: number;
};

type Bucket = "all" | "active" | "marketplace" | "zero" | "fulfilled";

function parseLead(r: Record<string, unknown>): LeadRow {
  return {
    id: str(r.id),
    customer_id: str(r.customer_id),
    customer_name: r.customer_name == null ? null : str(r.customer_name),
    customer_phone: r.customer_phone == null ? null : str(r.customer_phone),
    sub_category_name: str(r.sub_category_name ?? r.category_name, "Lead"),
    item_names: Array.isArray(r.item_names) ? r.item_names.map(String) : [],
    note: r.note == null ? null : str(r.note),
    images: Array.isArray(r.images) ? r.images.map(String) : [],
    address: r.address == null ? null : str(r.address),
    group_name: r.group_name == null ? null : str(r.group_name),
    status: str(r.status, "new"),
    is_marketplace: bool(r.is_marketplace),
    marketplace_reason: r.marketplace_reason == null ? null : str(r.marketplace_reason),
    marketplace_at: r.marketplace_at == null ? null : str(r.marketplace_at),
    accepted_count: num(r.accepted_count),
    max_slots: num(r.max_slots, 1),
    accepted_vendor_ids: Array.isArray(r.accepted_vendor_ids) ? r.accepted_vendor_ids.map(String) : [],
    created_at: str(r.created_at),
    notifications: Array.isArray(r.notifications)
      ? (r.notifications as Record<string, unknown>[]).map((n) => ({
          vendor_id: str(n.vendor_id),
          status: str(n.status),
          vendor_note: n.vendor_note == null ? null : str(n.vendor_note),
          responded_at: n.responded_at == null ? null : str(n.responded_at),
        }))
      : [],
    pending_count: num(r.pending_count),
    rejected_count: num(r.rejected_count),
  };
}

export default function LeadsPage() {
  const [bucket, setBucket] = useState<Bucket>("active");
  const [detail, setDetail] = useState<LeadRow | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-leads", bucket],
    queryFn: async () => {
      const raw = await apiFetch(`/v1/admin/leads?bucket=${bucket}`);
      return asList(raw).map(parseLead);
    },
  });

  const leads = q.data ?? [];
  const counts = {
    active: leads.filter((l) => !l.is_marketplace && l.status === "new").length,
    market: leads.filter((l) => l.is_marketplace).length,
  };

  const TABS: { id: Bucket; label: string; icon: typeof Radio }[] = useMemo(
    () => [
      { id: "active", label: "Active Broadcasts", icon: Radio },
      { id: "marketplace", label: "Marketplace", icon: Store },
      { id: "zero", label: "Zero Vendors", icon: AlertTriangle },
      { id: "fulfilled", label: "Fulfilled", icon: RefreshCw },
      { id: "all", label: "All", icon: RefreshCw },
    ],
    [],
  );

  async function act(leadId: string, action: "rebroadcast" | "marketplace" | "fulfill") {
    setActing(leadId);
    setActionErr(null);
    try {
      await apiFetch(`/v1/admin/leads`, {
        method: "POST",
        body: JSON.stringify({ action, lead_id: leadId, reason: action === "marketplace" ? "admin" : undefined }),
      });
      q.refetch();
      setDetail(null);
    } catch (err: unknown) {
      setActionErr(err instanceof Error ? err.message : "Lead action fail");
    } finally {
      setActing(null);
    }
  }

  return (
    <>
      <PageHeader
        title="All Leads — Control Center"
        subtitle="Live radar, marketplace fallback, manual override"
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setBucket(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition ${
              bucket === t.id
                ? "bg-[#d4af37] text-black shadow"
                : "bg-white/5 text-[#f5d97a]/80 hover:bg-white/10"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
        <button
          onClick={() => q.refetch()}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold bg-white/5 text-[#f5d97a]/80 hover:bg-white/10"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <GoldCard className="p-3">
          <p className="text-xs text-[#f5d97a]/70">Active Broadcasts</p>
          <p className="text-2xl font-bold text-[#d4af37]">{counts.active}</p>
        </GoldCard>
        <GoldCard className="p-3">
          <p className="text-xs text-[#f5d97a]/70">In Marketplace</p>
          <p className="text-2xl font-bold text-[#d4af37]">{counts.market}</p>
        </GoldCard>
      </div>

      {q.isError && (
        <div className="mb-4">
          <ErrorBanner
            message={q.error instanceof Error ? q.error.message : "Leads load fail"}
            onRetry={() => q.refetch()}
          />
        </div>
      )}
      {actionErr && (
        <div className="mb-4">
          <ErrorBanner message={actionErr} />
        </div>
      )}

      {q.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </div>
      ) : leads.length === 0 ? (
        <p className="text-center py-12 text-[#f5d97a]/60">Koi lead nahi mili is bucket mein.</p>
      ) : (
        <div className="space-y-2">
          {leads.map((l) => (
            <button
              key={l.id}
              onClick={() => setDetail(l)}
              className="w-full text-left p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#f5d97a] truncate">{l.sub_category_name}</p>
                  <p className="text-xs text-[#f5d97a]/60 truncate">
                    {l.customer_name || "—"} · {l.customer_phone || "—"} ·{" "}
                    {l.created_at ? new Date(l.created_at).toLocaleString() : "—"}
                  </p>
                  {l.address && (
                    <p className="text-[11px] text-[#f5d97a]/50 truncate mt-0.5">
                      <MapPin className="inline h-3 w-3" /> {l.address}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      l.is_marketplace
                        ? "bg-amber-500/30 text-amber-200"
                        : l.status === "fulfilled"
                          ? "bg-emerald-500/30 text-emerald-200"
                          : "bg-blue-500/30 text-blue-200"
                    }`}
                  >
                    {l.is_marketplace
                      ? `Marketplace · ${l.marketplace_reason || ""}`
                      : l.status}
                  </span>
                  <span className="text-[10px] text-[#f5d97a]/60">
                    {l.accepted_count}/{l.max_slots} accepted · {l.pending_count} pending ·{" "}
                    {l.rejected_count} rejected
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {detail && (
        <div
          className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4"
          onClick={() => setDetail(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#1a1a1a] border border-[#d4af37]/30 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-[#d4af37]">{detail.sub_category_name}</h3>
                <p className="text-xs text-[#f5d97a]/60 mt-1">
                  {detail.customer_name || "—"} ·{" "}
                  {detail.customer_phone && (
                    <a href={`tel:${detail.customer_phone}`} className="underline">
                      <Phone className="inline h-3 w-3" /> {detail.customer_phone}
                    </a>
                  )}
                </p>
                {detail.address && (
                  <p className="text-xs text-[#f5d97a]/60 mt-1">
                    <MapPin className="inline h-3 w-3" /> {detail.address}
                  </p>
                )}
              </div>
              <button onClick={() => setDetail(null)} className="text-[#f5d97a]/70 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            {detail.note && (
              <p className="text-sm text-[#f5d97a]/80 italic mb-3 bg-white/5 p-2 rounded">
                "{detail.note}"
              </p>
            )}

            {detail.images.length > 0 && (
              <div className="flex gap-2 overflow-x-auto mb-3">
                {detail.images.map((src) => (
                  <img
                    key={src}
                    src={src}
                    alt=""
                    className="h-20 w-20 object-cover rounded-lg flex-shrink-0"
                  />
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-center mb-4">
              <div className="bg-white/5 rounded p-2">
                <p className="text-[10px] text-[#f5d97a]/60">Status</p>
                <p className="text-sm font-bold text-[#f5d97a]">
                  {detail.is_marketplace ? "Marketplace" : detail.status}
                </p>
              </div>
              <div className="bg-white/5 rounded p-2">
                <p className="text-[10px] text-[#f5d97a]/60">Accepted</p>
                <p className="text-sm font-bold text-[#f5d97a]">
                  {detail.accepted_count}/{detail.max_slots}
                </p>
              </div>
              <div className="bg-white/5 rounded p-2">
                <p className="text-[10px] text-[#f5d97a]/60">Reason</p>
                <p className="text-sm font-bold text-[#f5d97a]">{detail.marketplace_reason || "—"}</p>
              </div>
            </div>

            <p className="text-xs font-bold text-[#d4af37] mb-2">
              Vendor responses ({detail.notifications.length})
            </p>
            <div className="space-y-1 mb-4 max-h-48 overflow-y-auto">
              {detail.notifications.length === 0 && (
                <p className="text-xs text-[#f5d97a]/50 italic">Abhi tak kisi vendor ko nahi bheji.</p>
              )}
              {detail.notifications.map((n) => (
                <div
                  key={n.vendor_id}
                  className="flex items-center justify-between bg-white/5 rounded px-2 py-1.5 text-xs"
                >
                  <span className="text-[#f5d97a]/80 truncate flex-1">
                    {n.vendor_id.slice(0, 8)}…
                    {n.vendor_note && <span className="text-amber-300 ml-2">"{n.vendor_note}"</span>}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      n.status === "accepted"
                        ? "bg-emerald-500/30 text-emerald-200"
                        : n.status === "rejected"
                          ? "bg-rose-500/30 text-rose-200"
                          : "bg-slate-500/30 text-slate-200"
                    }`}
                  >
                    {n.status}
                  </span>
                </div>
              ))}
            </div>

            <div className="grid sm:grid-cols-3 gap-2">
              <GoldButton
                onClick={() => act(detail.id, "rebroadcast")}
                disabled={acting === detail.id}
                className="w-full"
              >
                {acting === detail.id ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : <span className="flex items-center justify-center gap-2"><Radio className="h-4 w-4" /> Re-broadcast</span>}
              </GoldButton>
              <GoldButton
                variant="outline"
                onClick={() => act(detail.id, "marketplace")}
                disabled={acting === detail.id}
                className="w-full"
              >
                Marketplace
              </GoldButton>
              <GoldButton
                variant="outline"
                onClick={() => act(detail.id, "fulfill")}
                disabled={acting === detail.id}
                className="w-full"
              >
                Mark fulfilled
              </GoldButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
