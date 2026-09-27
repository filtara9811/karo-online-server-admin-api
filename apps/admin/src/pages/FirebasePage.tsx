import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, CheckCircle2, Flame, Loader2, Save, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader, inputCls } from "@/components/admin/AdminLayout";

type FcmStatus = {
  configured: boolean;
  project_id: string | null;
  client_email: string | null;
  is_active: boolean;
};

type TestResult = { ok: boolean; sent?: number; total?: number; reason?: string; results?: Array<{ ok: boolean; error?: string }> };

export default function FirebasePage() {
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [phone, setPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-fcm"],
    queryFn: async () => (await apiFetch("/v1/admin/fcm")) as FcmStatus,
  });

  const save = async () => {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      await apiFetch("/v1/admin/fcm", { method: "PUT", body: JSON.stringify({ service_account_json: json, is_active: true }) });
      setJson("");
      setSaved(true);
      await q.refetch();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save the key");
    } finally {
      setSaving(false);
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (file) setJson(await file.text());
  };

  const sendTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = (await apiFetch("/v1/admin/fcm/test", { method: "POST", body: JSON.stringify({ phone }) })) as TestResult;
      if (r.ok) setTestMsg(`Sent to ${r.sent} of ${r.total} device(s). The phone should ring now.`);
      else if (r.reason === "no_device_tokens") setTestMsg("This user has no registered device. Open the app on the phone and allow notifications first.");
      else if (r.reason === "fcm_not_configured") setTestMsg("Save the service account key first.");
      else setTestMsg(`Not delivered: ${r.results?.find((x) => !x.ok)?.error?.slice(0, 200) ?? r.reason ?? "unknown error"}`);
    } catch (e: unknown) {
      setTestMsg(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const s = q.data;

  return (
    <>
      <PageHeader title="Firebase Cloud Messaging" subtitle="Push notifications and the new-request ring for vendors" />
      {q.isError && (
        <div className="mb-4">
          <ErrorBanner message={q.error instanceof Error ? q.error.message : "Could not load settings"} onRetry={() => q.refetch()} />
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
      ) : (
        <div className="grid gap-4">
          <GoldCard className="p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="h-11 w-11 rounded-xl grid place-items-center shrink-0"
                  style={{ background: "linear-gradient(180deg,#ffb648,#ff7a18,#a13b00)" }}
                >
                  <Flame className="h-5 w-5 text-[#1a1208]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-bold admin-title truncate">Service account</h3>
                  <p className="text-xs truncate" style={{ color: "var(--admin-muted)" }}>
                    {s?.configured ? `${s.project_id} · ${s.client_email}` : "Not set up. Push notifications are not being sent."}
                  </p>
                </div>
              </div>
              <span
                className={`text-[9px] uppercase tracking-wider px-2 py-1 rounded-full font-bold ${
                  s?.configured && s.is_active ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                }`}
              >
                {s?.configured && s.is_active ? "Active" : "Not configured"}
              </span>
            </div>
            <p className="text-xs mb-3" style={{ color: "var(--admin-muted)" }}>
              In the Firebase console open Project settings → Service accounts → Generate new private key, then upload or paste the
              downloaded JSON file here. The key is checked with Google before it is saved.
            </p>
            <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer mb-2" style={{ color: "var(--admin-muted)" }}>
              <Upload className="h-3.5 w-3.5" />
              Upload JSON file
              <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
            </label>
            <textarea
              rows={6}
              value={json}
              placeholder={s?.configured ? "Paste a new key only if you want to replace the current one" : '{ "type": "service_account", ... }'}
              onChange={(e) => setJson(e.target.value)}
              className={`${inputCls} font-mono text-[11px] w-full`}
            />
            <GoldButton onClick={save} disabled={saving || json.trim().length < 2} className="w-full mt-3">
              <Save className="h-3.5 w-3.5 inline mr-1.5" />
              {saving ? "Checking with Google…" : "Save and verify key"}
            </GoldButton>
            {saved && (
              <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Key verified and saved.
              </p>
            )}
          </GoldCard>

          <GoldCard className="p-5">
            <h3 className="font-display text-lg font-bold admin-title mb-1">Send a test alert</h3>
            <p className="text-xs mb-3" style={{ color: "var(--admin-muted)" }}>
              Sends a high-priority alert with the lead ring to every device signed in with this phone number.
            </p>
            <div className="flex gap-2">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="10-digit mobile number"
                inputMode="numeric"
                className={`${inputCls} flex-1`}
              />
              <GoldButton onClick={sendTest} disabled={testing || !s?.configured || phone.replace(/\D/g, "").length < 10}>
                <BellRing className="h-3.5 w-3.5 inline mr-1.5" />
                {testing ? "Sending…" : "Send test"}
              </GoldButton>
            </div>
            {testMsg && (
              <p className="mt-2 text-xs" style={{ color: "var(--admin-muted)" }}>
                {testMsg}
              </p>
            )}
          </GoldCard>
        </div>
      )}
    </>
  );
}
