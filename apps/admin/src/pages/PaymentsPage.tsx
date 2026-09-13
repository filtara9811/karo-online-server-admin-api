import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Loader2, Save } from "lucide-react";
import { apiFetch, asList, bool, num, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, GoldToggle, PageHeader, inputCls } from "@/components/admin/AdminLayout";

type GatewayPurpose = "wallet_recharge" | "coin_purchase" | "both";

type Gateway = {
  id: string;
  provider: string;
  display_name: string;
  is_active: boolean;
  is_test_mode: boolean;
  public_key: string | null;
  config: Record<string, string>;
  purpose: GatewayPurpose;
  priority: number;
};

function parseGw(g: Record<string, unknown>): Gateway {
  const cfg =
    g.config && typeof g.config === "object" && !Array.isArray(g.config)
      ? (g.config as Record<string, string>)
      : {};
  return {
    id: str(g.id),
    provider: str(g.provider),
    display_name: str(g.display_name, str(g.provider)),
    is_active: bool(g.is_active),
    is_test_mode: bool(g.is_test_mode),
    public_key: g.public_key == null ? null : str(g.public_key),
    config: cfg,
    purpose: (str(g.purpose, "both") as GatewayPurpose) || "both",
    priority: num(g.priority),
  };
}

export default function PaymentsPage() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-table", "payment_gateways"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/payment_gateways")).map(parseGw),
  });

  useEffect(() => {
    if (q.data) setGateways(q.data);
  }, [q.data]);

  const update = (id: string, patch: Partial<Gateway>) => {
    setGateways((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };

  const save = async (g: Gateway) => {
    setSavingId(g.id);
    setSaveErr(null);
    try {
      await apiFetch(`/v1/admin/table/payment_gateways${g.id ? `?id=${encodeURIComponent(g.id)}` : ""}`, {
        method: g.id ? "PATCH" : "POST",
        body: JSON.stringify(g),
      });
      await q.refetch();
    } catch (err: unknown) {
      setSaveErr(err instanceof Error ? err.message : "Save fail");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <PageHeader title="Payment Gateways" subtitle="Razorpay / Stripe / PhonePe configuration" />

      <GoldCard className="p-4 mb-4">
        <p className="text-xs text-[#f5d97a]/85 leading-relaxed">
          💡 <b className="text-[#fff8dc]">Tip:</b> Har gateway ko ek <b>purpose</b> assign karein — ek
          gateway sirf <b>Wallet Recharge</b> ke liye, dusra sirf <b>LeadX Coin Purchase</b> ke liye.
          Vendor app me sahi gateway automatically chosen ho jayega.
        </p>
      </GoldCard>

      {q.isError && (
        <div className="mb-4">
          <ErrorBanner
            message={q.error instanceof Error ? q.error.message : "Gateways load fail"}
            onRetry={() => q.refetch()}
          />
        </div>
      )}
      {saveErr && (
        <div className="mb-4">
          <ErrorBanner message={saveErr} />
        </div>
      )}

      {q.isLoading ? (
        <GoldCard className="p-16 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </GoldCard>
      ) : gateways.length === 0 ? (
        <GoldCard className="p-12 text-center text-[#f5d97a]/60 text-sm">
          Koi payment gateway configured nahi hai.
        </GoldCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {gateways.map((g) => (
            <GoldCard key={g.id} className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="h-11 w-11 rounded-xl grid place-items-center"
                    style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
                  >
                    <CreditCard className="h-5 w-5 text-[#1a1208]" />
                  </div>
                  <div>
                    <h3
                      className="font-display text-lg font-bold"
                      style={{
                        background: "linear-gradient(180deg, #fff8dc, #d4af37)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                      }}
                    >
                      {g.display_name}
                    </h3>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#d4af37]/60">{g.provider}</p>
                  </div>
                </div>
                <span
                  className={`text-[9px] uppercase tracking-wider px-2 py-1 rounded-full font-bold ${
                    g.is_active
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-black/40 text-[#d4af37]/60 border border-[#d4af37]/20"
                  }`}
                >
                  {g.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-1.5 block">
                    Public Key {g.provider === "razorpay" ? "(Key ID)" : "(Publishable Key)"}
                  </label>
                  <input
                    value={g.public_key ?? ""}
                    onChange={(e) => update(g.id, { public_key: e.target.value })}
                    placeholder={g.provider === "razorpay" ? "rzp_test_..." : "pk_test_..."}
                    className={`${inputCls} font-mono text-xs`}
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-1.5 block">
                    Secret Key {g.provider === "razorpay" ? "(Key Secret)" : "(API Secret)"}
                  </label>
                  <input
                    type="password"
                    value={g.config?.secret_key ?? ""}
                    onChange={(e) =>
                      update(g.id, { config: { ...(g.config ?? {}), secret_key: e.target.value } })
                    }
                    placeholder="••••••••••••••••"
                    className={`${inputCls} font-mono text-xs`}
                  />
                  <p className="text-[9px] text-[#d4af37]/50 mt-1">
                    Server-side only — never exposed to browser
                  </p>
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-1.5 block">
                    Purpose
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { v: "wallet_recharge", l: "Wallet" },
                        { v: "coin_purchase", l: "Coins" },
                        { v: "both", l: "Both" },
                      ] as const
                    ).map((opt) => {
                      const active = g.purpose === opt.v;
                      return (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => update(g.id, { purpose: opt.v })}
                          className={`px-2 py-2 rounded-xl text-[10px] uppercase tracking-wider font-bold transition border ${
                            active
                              ? "text-[#1a1208] border-transparent"
                              : "text-[#f5d97a]/70 border-[#d4af37]/30 hover:bg-[#d4af37]/10"
                          }`}
                          style={
                            active
                              ? { background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }
                              : undefined
                          }
                        >
                          {opt.l}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <GoldToggle
                    label="Test"
                    value={g.is_test_mode}
                    onChange={(v) => update(g.id, { is_test_mode: v })}
                  />
                  <GoldToggle
                    label="Active"
                    value={g.is_active}
                    onChange={(v) => update(g.id, { is_active: v })}
                  />
                  <div className="flex flex-col gap-1 px-3 py-2 rounded-xl bg-black/40 border border-[#d4af37]/30">
                    <span className="text-[9px] uppercase tracking-[0.2em] text-[#f5d97a]/80 font-bold">
                      Priority
                    </span>
                    <input
                      type="number"
                      value={g.priority}
                      onChange={(e) => update(g.id, { priority: parseInt(e.target.value) || 0 })}
                      className="w-full bg-transparent text-[#fff8dc] outline-none text-sm font-bold"
                    />
                  </div>
                </div>

                <GoldButton onClick={() => save(g)} disabled={savingId === g.id} className="w-full mt-2">
                  <Save className="h-3.5 w-3.5 inline mr-1.5" />
                  {savingId === g.id ? "Saving..." : "Save Configuration"}
                </GoldButton>
              </div>

              <p className="text-[10px] text-[#d4af37]/50 mt-3 leading-relaxed">
                🔐 Secret keys (key_secret / sk_) ko server secrets mein store karein — yahan sirf safe
                public key paste karein.
              </p>
            </GoldCard>
          ))}
        </div>
      )}
    </>
  );
}
