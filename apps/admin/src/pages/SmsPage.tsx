import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MessageSquare, Save } from "lucide-react";
import { apiFetch, asList, asRecord, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, GoldToggle, PageHeader, inputCls } from "@/components/admin/AdminLayout";

type Gw = {
  id: string;
  provider: string;
  display_name: string;
  is_active: boolean;
  is_test_mode: boolean;
  config: Record<string, unknown>;
};

const KNOWN: Record<string, string[]> = {
  msg91: ["auth_key", "sender_id", "route", "country", "template_id"],
  fast2sms: ["api_key", "sender_id", "route", "message_id", "template_id"],
};

function parse(g: Record<string, unknown>): Gw {
  return {
    id: str(g.id),
    provider: str(g.provider),
    display_name: str(g.display_name, str(g.provider)),
    is_active: bool(g.is_active),
    is_test_mode: bool(g.is_test_mode),
    config: asRecord(g.config),
  };
}

function configKeys(g: Gw) {
  const known = KNOWN[g.provider] ?? ["api_key", "sender_id", "template_id"];
  const extra = Object.keys(g.config).filter((k) => k !== "templates" && !known.includes(k));
  return [...known, ...extra];
}

function cfgStr(cfg: Record<string, unknown>, key: string) {
  const v = cfg[key];
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function SmsPage() {
  const [rows, setRows] = useState<Gw[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin-table", "sms_gateways"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/sms_gateways")).map(parse),
  });

  useEffect(() => {
    if (q.data) setRows(q.data);
  }, [q.data]);

  const save = async (g: Gw) => {
    setSaving(g.id);
    setErr(null);
    try {
      await apiFetch(`/v1/admin/table/sms_gateways?id=${encodeURIComponent(g.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          is_active: g.is_active,
          is_test_mode: g.is_test_mode,
          config: g.config,
        }),
      });
      await q.refetch();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save fail");
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <PageHeader title="SMS Gateways" subtitle="OTP keys DB se — sirf ek active rahega" />
      {q.isError && (
        <div className="mb-4">
          <ErrorBanner message={q.error instanceof Error ? q.error.message : "Load fail"} onRetry={() => q.refetch()} />
        </div>
      )}
      {err && (
        <div className="mb-4">
          <ErrorBanner message={err} />
        </div>
      )}
      {q.isLoading ? (
        <GoldCard className="p-16 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </GoldCard>
      ) : rows.length === 0 ? (
        <GoldCard className="p-12 text-center text-sm text-[#d4af37]/70">
          sms_gateways me koi row nahi mili.
        </GoldCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {rows.map((g) => (
            <GoldCard key={g.id} className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="h-11 w-11 rounded-xl grid place-items-center"
                  style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
                >
                  <MessageSquare className="h-5 w-5 text-[#1a1208]" />
                </div>
                <div>
                  <p className="font-display font-bold">{g.display_name}</p>
                  <p className="text-[10px] uppercase tracking-wider text-[#d4af37]/70">{g.provider}</p>
                </div>
              </div>
              {configKeys(g).map((k) => (
                <label key={k} className="text-[10px] uppercase tracking-wider font-bold block mb-3" style={{ color: "var(--admin-muted)" }}>
                  {k.replace(/_/g, " ")}
                  <input
                    value={cfgStr(g.config, k)}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r) => (r.id === g.id ? { ...r, config: { ...r.config, [k]: e.target.value } } : r)),
                      )
                    }
                    className={`${inputCls} mt-1 font-mono text-xs`}
                  />
                </label>
              ))}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <GoldToggle
                  label="Test"
                  value={g.is_test_mode}
                  onChange={(v) => setRows((p) => p.map((r) => (r.id === g.id ? { ...r, is_test_mode: v } : r)))}
                />
                <GoldToggle
                  label="Active"
                  value={g.is_active}
                  onChange={(v) => setRows((p) => p.map((r) => (r.id === g.id ? { ...r, is_active: v } : r)))}
                />
              </div>
              <GoldButton onClick={() => save(g)} disabled={saving === g.id} className="w-full">
                <Save className="h-3.5 w-3.5 inline mr-1.5" />
                {saving === g.id ? "Saving…" : "Save keys"}
              </GoldButton>
            </GoldCard>
          ))}
        </div>
      )}
    </>
  );
}
