import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Store, Mail, Phone, ShieldCheck, Crown, Search, RefreshCw } from "lucide-react";
import { apiFetch, asList, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader } from "@/components/admin/AdminLayout";

export default function VendorsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["admin-vendors"],
    queryFn: async () => asList(await apiFetch("/v1/admin/vendors")),
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = query.data ?? [];
    if (!s) return rows;
    return rows.filter((v) =>
      [v.business_name, v.owner_name, v.email, v.phone, v.trade, v.gst]
        .map((x) => String(x ?? "").toLowerCase())
        .some((x) => x.includes(s)),
    );
  }, [query.data, q]);

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle={`${query.data?.length ?? 0} registered vendors`}
        action={
          <div className="flex gap-2">
            <GoldButton variant="outline" onClick={() => navigate("/scan-insights")}>
              Scan insights
            </GoldButton>
            <GoldButton variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 inline mr-1.5 ${query.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </GoldButton>
          </div>
        }
      />

      <GoldCard className="p-3 mb-4">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#d4af37]/70" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search business, owner, phone, GST…"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-black/30 border border-[#d4af37]/30 text-[#f5d97a] placeholder:text-[#f5d97a]/40 focus:outline-none focus:border-[#d4af37]"
          />
        </div>
      </GoldCard>

      {query.isError && (
        <div className="mb-4">
          <ErrorBanner
            message={query.error instanceof Error ? query.error.message : "Vendors load fail"}
            onRetry={() => query.refetch()}
          />
        </div>
      )}

      {query.isLoading ? (
        <GoldCard className="p-12 text-center">
          <p className="text-[#f5d97a]/60">Loading vendors…</p>
        </GoldCard>
      ) : filtered.length === 0 ? (
        <GoldCard className="p-12 text-center">
          <Store className="h-12 w-12 text-[#d4af37]/40 mx-auto mb-4" />
          <h3
            className="font-display text-xl font-bold"
            style={{
              background: "linear-gradient(180deg, #fff8dc, #d4af37)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {(query.data?.length ?? 0) === 0 ? "No vendors yet" : "No matches"}
          </h3>
        </GoldCard>
      ) : (
        <div className="space-y-3">
          {filtered.map((v) => {
            const uid = str(v.user_id ?? v.id);
            return (
              <button
                key={str(v.id, uid)}
                type="button"
                onClick={() => navigate(`/users/${uid}`)}
                className="block w-full text-left"
              >
                <GoldCard className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-full overflow-hidden border-2 border-[#d4af37]/40 flex-shrink-0 bg-gradient-to-br from-[#fff8dc] to-[#d4af37] grid place-items-center">
                      <span className="font-display text-lg font-bold text-[#1a1a1a]">
                        {str(v.business_name || v.owner_name || "?", "?").charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h3 className="font-display text-base font-bold text-[#f5d97a] truncate">
                          {str(v.business_name || v.owner_name, "Unnamed vendor")}
                        </h3>
                        {bool(v.is_premium) && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40">
                            <Crown className="h-2.5 w-2.5" /> PREMIUM
                          </span>
                        )}
                        {bool(v.verified) && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                            <ShieldCheck className="h-2.5 w-2.5" /> VERIFIED
                          </span>
                        )}
                        {bool(v.is_blocked) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                            BLOCKED
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#f5d97a]/70 mt-0.5 truncate">
                        {str(v.trade || v.deals_in, "—")}
                      </p>
                      <div className="mt-1 space-y-0.5 text-xs text-[#f5d97a]/75">
                        {!!v.email && (
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3 w-3" /> {str(v.email)}
                          </div>
                        )}
                        {!!(v.phone || v.whatsapp) && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3" /> {str(v.phone || v.whatsapp)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </GoldCard>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
