import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Store, Mail, Phone, ShieldCheck, Crown, Search, RefreshCw, Coins, Loader2, X } from "lucide-react";
import { apiFetch, asList, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader } from "@/components/admin/AdminLayout";

type CoinsResult = { vendor_id: string; business_name: string | null; coins_left: number };

/** Inline "give / deduct LeadX coins" form for one vendor (testing helper). */
function VendorCoinsPanel({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const [coins, setCoins] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const save = async () => {
    const n = Number(coins);
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 100000) {
      setErr("Enter a whole number of coins (non-zero, up to ±100000)");
      return;
    }
    setSaving(true);
    setErr(null);
    setOkMsg(null);
    try {
      const r = await apiFetch<CoinsResult>(`/v1/admin/vendors/${userId}/coins`, {
        method: "POST",
        body: JSON.stringify({ coins: n, note: note.trim() || undefined }),
      });
      setOkMsg(`${n > 0 ? "Added" : "Deducted"} ${Math.abs(n)} coin${Math.abs(n) === 1 ? "" : "s"} · Now ${r.coins_left} coins`);
      setCoins("");
      setNote("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-[#d4af37]/20 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#d4af37] font-bold">Give LeadX coins (testing) · {name}</p>
        <button type="button" onClick={onClose} className="text-[#f5d97a]/70" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      {err && <ErrorBanner message={err} />}
      {okMsg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{okMsg}</div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#d4af37]/70 font-bold">Coins (− to deduct)</label>
          <input
            type="number"
            step={1}
            min={-100000}
            max={100000}
            value={coins}
            placeholder="e.g. 50 or -10"
            onChange={(e) => setCoins(e.target.value)}
            className="block w-40 mt-0.5 px-3 py-2 rounded-lg bg-black/40 border border-[#d4af37]/30 text-[#fff8dc] placeholder:text-[#f5d97a]/40 outline-none focus:border-[#d4af37] text-sm"
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="text-[10px] uppercase tracking-wider text-[#d4af37]/70 font-bold">Note (optional)</label>
          <input
            type="text"
            maxLength={200}
            value={note}
            placeholder="Admin adjustment"
            onChange={(e) => setNote(e.target.value)}
            className="block w-full mt-0.5 px-3 py-2 rounded-lg bg-black/40 border border-[#d4af37]/30 text-[#fff8dc] placeholder:text-[#f5d97a]/40 outline-none focus:border-[#d4af37] text-sm"
          />
        </div>
        <GoldButton onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin inline mr-1.5" /> : <Coins className="h-4 w-4 inline mr-1.5" />}
          Save
        </GoldButton>
      </div>
    </div>
  );
}

export default function VendorsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [coinsFor, setCoinsFor] = useState<string | null>(null);
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
            const name = str(v.business_name || v.owner_name, "Unnamed vendor");
            const showCoins = coinsFor === uid;
            return (
              <GoldCard key={str(v.id, uid)} className="p-4">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/users/${uid}`)}
                    className="flex-1 min-w-0 flex items-start gap-3 text-left"
                  >
                    <div className="h-12 w-12 rounded-full overflow-hidden border-2 border-[#d4af37]/40 flex-shrink-0 bg-gradient-to-br from-[#fff8dc] to-[#d4af37] grid place-items-center">
                      <span className="font-display text-lg font-bold text-[#1a1a1a]">
                        {str(v.business_name || v.owner_name || "?", "?").charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h3 className="font-display text-base font-bold text-[#f5d97a] truncate">
                          {name}
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
                  </button>
                  <GoldButton
                    variant="outline"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => setCoinsFor(showCoins ? null : uid)}
                  >
                    <Coins className="h-3.5 w-3.5 inline mr-1" />
                    Coins
                  </GoldButton>
                </div>
                {showCoins && <VendorCoinsPanel userId={uid} name={name} onClose={() => setCoinsFor(null)} />}
              </GoldCard>
            );
          })}
        </div>
      )}
    </>
  );
}
