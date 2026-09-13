import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, Mail, Phone, MapPin, ShieldCheck, Search, RefreshCw } from "lucide-react";
import { apiFetch, asList, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader } from "@/components/admin/AdminLayout";

export default function CustomersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["admin-customers"],
    queryFn: async () => asList(await apiFetch("/v1/admin/customers")),
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = query.data ?? [];
    if (!s) return rows;
    return rows.filter((c) =>
      [c.name, c.email, c.phone, c.address, c.support_code]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(s)),
    );
  }, [query.data, q]);

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${query.data?.length ?? 0} registered users`}
        action={
          <GoldButton variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 inline mr-1.5 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </GoldButton>
        }
      />

      <GoldCard className="p-3 mb-4">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#d4af37]/70" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, email, support code…"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-black/30 border border-[#d4af37]/30 text-[#f5d97a] placeholder:text-[#f5d97a]/40 focus:outline-none focus:border-[#d4af37]"
          />
        </div>
      </GoldCard>

      {query.isError && (
        <div className="mb-4">
          <ErrorBanner
            message={query.error instanceof Error ? query.error.message : "Customers load fail"}
            onRetry={() => query.refetch()}
          />
        </div>
      )}

      {query.isLoading ? (
        <GoldCard className="p-12 text-center">
          <p className="text-[#f5d97a]/60">Loading customers…</p>
        </GoldCard>
      ) : filtered.length === 0 ? (
        <GoldCard className="p-12 text-center">
          <Users className="h-12 w-12 text-[#d4af37]/40 mx-auto mb-4" />
          <h3
            className="font-display text-xl font-bold mb-2"
            style={{
              background: "linear-gradient(180deg, #fff8dc, #d4af37)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {(query.data?.length ?? 0) === 0 ? "No customers yet" : "No matches"}
          </h3>
        </GoldCard>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const uid = str(c.user_id ?? c.id);
            return (
              <button
                key={str(c.id, uid)}
                type="button"
                onClick={() => navigate(`/users/${uid}`)}
                className="block w-full text-left"
              >
                <GoldCard className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-full overflow-hidden border-2 border-[#d4af37]/40 flex-shrink-0 bg-gradient-to-br from-[#fff8dc] to-[#d4af37] grid place-items-center">
                      {c.avatar_url ? (
                        <img src={str(c.avatar_url)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="font-display text-lg font-bold text-[#1a1a1a]">
                          {str(c.name || c.email || "?", "?").charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h3 className="font-display text-base font-bold text-[#f5d97a] truncate">
                          {str(c.name, "Unnamed customer")}
                        </h3>
                        {c.support_code != null && String(c.support_code) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40 font-mono">
                            #{String(c.support_code)}
                          </span>
                        )}
                        {bool(c.verified) && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                            <ShieldCheck className="h-2.5 w-2.5" /> VERIFIED
                          </span>
                        )}
                        {bool(c.is_blocked) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                            BLOCKED
                          </span>
                        )}
                      </div>
                      <div className="mt-1 space-y-0.5 text-xs text-[#f5d97a]/75">
                        {!!c.email && (
                          <div className="flex items-center gap-1.5">
                            <Mail className="h-3 w-3" /> {str(c.email)}
                          </div>
                        )}
                        {!!c.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3" /> {str(c.phone)}
                          </div>
                        )}
                        {!!c.address && (
                          <div className="flex items-start gap-1.5">
                            <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                            <span className="line-clamp-2">{str(c.address)}</span>
                          </div>
                        )}
                      </div>
                      {c.created_at != null && (
                        <p className="text-[10px] text-[#f5d97a]/40 mt-1.5">
                          Joined {new Date(str(c.created_at)).toLocaleString()}
                        </p>
                      )}
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
