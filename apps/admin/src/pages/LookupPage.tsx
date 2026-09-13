import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2, Hash } from "lucide-react";
import { apiFetch, asList, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldCard, PageHeader } from "@/components/admin/AdminLayout";

type LookupHit = {
  customer: Record<string, unknown>;
  vendor: Record<string, unknown> | null;
  wallet: Record<string, unknown> | null;
};

export default function LookupPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch("/v1/admin/lookup", {
        method: "POST",
        body: JSON.stringify({ q: q.trim() }),
      });
      const rec = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
      const list = asList(rec.results ?? rec);
      setHits(
        list.map((h) => {
          if (h.customer && typeof h.customer === "object") return h as unknown as LookupHit;
          return { customer: h, vendor: null, wallet: null };
        }),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Lookup failed");
      setHits([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="🔍 User Lookup (Customer 360)"
        subtitle="4-digit support code, phone, email, name ya user ID se search karo"
      />

      <GoldCard className="p-4 mb-4">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#d4af37]/70" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="4821 / 9876543210 / user@mail / Name"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-black/30 border border-[#d4af37]/30 text-[#f5d97a] placeholder:text-[#f5d97a]/40 focus:outline-none focus:border-[#d4af37]"
            />
          </div>
          <button
            onClick={run}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-b from-[#fff8dc] via-[#f5d97a] to-[#d4af37] text-[#1a1a1a] font-bold text-sm disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </button>
        </div>
      </GoldCard>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={run} />
        </div>
      )}

      <div className="space-y-2">
        {hits.map((h) => {
          const c = h.customer;
          const uid = str(c.user_id ?? c.id);
          return (
            <button
              key={uid}
              onClick={() => navigate(`/users/${uid}`)}
              className="block w-full text-left"
            >
              <GoldCard className="p-3 hover:border-[#d4af37]/60 transition">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#fff8dc] to-[#d4af37] grid place-items-center font-bold text-[#1a1a1a]">
                    {str(c.name || c.email || "?", "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-[#f5d97a] truncate">
                        {str(c.name, "Unnamed")}
                      </span>
                      {c.support_code != null && String(c.support_code) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40 font-mono flex items-center gap-0.5">
                          <Hash className="h-2.5 w-2.5" />
                          {String(c.support_code)}
                        </span>
                      )}
                      {h.vendor && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          VENDOR
                        </span>
                      )}
                      {bool(c.is_blocked) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                          BLOCKED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#f5d97a]/70 truncate">
                      {str(c.phone, "—")} · {str(c.email, "—")}
                    </p>
                  </div>
                </div>
              </GoldCard>
            </button>
          );
        })}
      </div>
    </>
  );
}
