import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { apiFetch, asList, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, GoldToggle, PageHeader, inputCls } from "@/components/admin/AdminLayout";

const CHECKS: { key: string; label: string; hint: string }[] = [
  { key: "aadhaar", label: "Aadhaar Verification", hint: "OTP-based Aadhaar verify" },
  { key: "pan", label: "PAN Card Verification", hint: "PAN number + name match" },
  { key: "gst", label: "GST Verification", hint: "GSTIN lookup + business name" },
  { key: "msme", label: "MSME / Udyam Certificate", hint: "Udyam Registration verify" },
  { key: "bank_account", label: "Bank Account Verification", hint: "Penny-drop / IFSC verify" },
  { key: "upi_vpa", label: "UPI VPA Verification", hint: "UPI handle name match" },
  { key: "voter_id", label: "Voter ID", hint: "EPIC number verify" },
  { key: "driving_license", label: "Driving License", hint: "DL number verify" },
  { key: "passport", label: "Passport", hint: "Passport file number verify" },
  { key: "cin", label: "CIN (Company)", hint: "MCA company lookup" },
];

type Provider = {
  id: string;
  provider: string;
  display_name: string;
  is_active: boolean;
  is_test_mode: boolean;
  app_id: string | null;
  secret_key: string | null;
  enabled_checks: Record<string, boolean>;
  config: Record<string, string>;
};

function parseP(p: Record<string, unknown>): Provider {
  return {
    id: str(p.id),
    provider: str(p.provider),
    display_name: str(p.display_name, str(p.provider)),
    is_active: bool(p.is_active),
    is_test_mode: bool(p.is_test_mode),
    app_id: p.app_id == null ? null : str(p.app_id),
    secret_key: p.secret_key == null ? null : str(p.secret_key),
    enabled_checks:
      p.enabled_checks && typeof p.enabled_checks === "object"
        ? (p.enabled_checks as Record<string, boolean>)
        : {},
    config: p.config && typeof p.config === "object" ? (p.config as Record<string, string>) : {},
  };
}

export default function KycPage() {
  const [list, setList] = useState<Provider[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-table", "kyc_providers"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/kyc_providers")).map(parseP),
  });

  useEffect(() => {
    if (q.data) setList(q.data);
  }, [q.data]);

  const update = (id: string, patch: Partial<Provider>) =>
    setList((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const save = async (p: Provider) => {
    setSavingId(p.id);
    setSaveErr(null);
    try {
      await apiFetch("/v1/admin/table/kyc_providers", {
        method: "POST",
        body: JSON.stringify(p),
      });
    } catch (err: unknown) {
      setSaveErr(err instanceof Error ? err.message : "Save fail");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="KYC Verification"
        subtitle="Vendor onboarding ke time Aadhaar / PAN / GST / Bank verify karne ke liye provider configure karein"
      />

      <GoldCard className="p-4 mb-4">
        <p className="text-xs text-[#f5d97a]/85 leading-relaxed">
          🔐 <b className="text-[#fff8dc]">Cashfree Verification Suite</b> ke through vendor ki Aadhaar,
          PAN card, GST, MSME certificate, aur Bank Account real-time verify hota hai. Yahan se select
          karein konse checks zaroori hain vendor onboarding ke time par.
        </p>
      </GoldCard>

      {q.isError && (
        <div className="mb-4">
          <ErrorBanner
            message={q.error instanceof Error ? q.error.message : "KYC load fail"}
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
      ) : list.length === 0 ? (
        <GoldCard className="p-12 text-center text-[#f5d97a]/60 text-sm">
          Koi KYC provider configured nahi hai.
        </GoldCard>
      ) : (
        <div className="grid gap-4">
          {list.map((p) => (
            <GoldCard key={p.id} className="p-5">
              <div className="flex items-start justify-between mb-4 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-11 w-11 rounded-xl grid place-items-center shrink-0"
                    style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
                  >
                    <ShieldCheck className="h-5 w-5 text-[#1a1208]" />
                  </div>
                  <div className="min-w-0">
                    <h3
                      className="font-display text-lg font-bold truncate"
                      style={{
                        background: "linear-gradient(180deg, #fff8dc, #d4af37)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                      }}
                    >
                      {p.display_name}
                    </h3>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#d4af37]/60">{p.provider}</p>
                  </div>
                </div>
                <span
                  className={`text-[9px] uppercase tracking-wider px-2 py-1 rounded-full font-bold whitespace-nowrap ${
                    p.is_active
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-black/40 text-[#d4af37]/60 border border-[#d4af37]/20"
                  }`}
                >
                  {p.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-1.5 block">
                    Client ID / App ID
                  </label>
                  <input
                    value={p.app_id ?? ""}
                    onChange={(e) => update(p.id, { app_id: e.target.value })}
                    placeholder="TEST_xxx... / PROD_xxx..."
                    className={`${inputCls} font-mono text-xs`}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-1.5 block">
                    Client Secret
                  </label>
                  <input
                    type="password"
                    value={p.secret_key ?? ""}
                    onChange={(e) => update(p.id, { secret_key: e.target.value })}
                    placeholder="••••••••••••••••"
                    className={`${inputCls} font-mono text-xs`}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-2 block">
                  Enabled Verification Checks
                </label>
                <div className="grid sm:grid-cols-2 gap-2">
                  {CHECKS.map((c) => {
                    const on = !!p.enabled_checks?.[c.key];
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() =>
                          update(p.id, {
                            enabled_checks: { ...p.enabled_checks, [c.key]: !on },
                          })
                        }
                        className={`flex items-start justify-between gap-3 px-3 py-2.5 rounded-xl border text-left transition ${
                          on
                            ? "border-[#d4af37] bg-[#d4af37]/10"
                            : "border-[#d4af37]/20 bg-black/30 hover:bg-[#d4af37]/5"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[#fff8dc] truncate">{c.label}</div>
                          <div className="text-[10px] text-[#d4af37]/70 truncate">{c.hint}</div>
                        </div>
                        <div
                          className={`relative h-5 w-9 rounded-full transition shrink-0 ${on ? "" : "bg-black/60"}`}
                          style={
                            on
                              ? { background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }
                              : undefined
                          }
                        >
                          <div
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                              on ? "left-[18px]" : "left-0.5"
                            }`}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4">
                <GoldToggle
                  label="Test Mode"
                  value={p.is_test_mode}
                  onChange={(v) => update(p.id, { is_test_mode: v })}
                />
                <GoldToggle
                  label="Active"
                  value={p.is_active}
                  onChange={(v) => update(p.id, { is_active: v })}
                />
              </div>

              <GoldButton onClick={() => save(p)} disabled={savingId === p.id} className="w-full mt-3">
                <Save className="h-3.5 w-3.5 inline mr-1.5" />
                {savingId === p.id ? "Saving..." : "Save Configuration"}
              </GoldButton>
            </GoldCard>
          ))}
        </div>
      )}
    </>
  );
}
