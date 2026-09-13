import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, Loader2, Save } from "lucide-react";
import { apiFetch, asList, bool, num, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, GoldToggle, PageHeader, inputCls } from "@/components/admin/AdminLayout";

type Service = {
  id: string;
  service_key: string;
  display_name: string;
  description: string;
  project_id: string;
  app_id: string;
  sender_id: string;
  web_api_key: string;
  server_key: string;
  service_account_json: string;
  is_active: boolean;
  is_test_mode: boolean;
  priority: number;
};

function parse(r: Record<string, unknown>): Service {
  return {
    id: str(r.id),
    service_key: str(r.service_key),
    display_name: str(r.display_name, str(r.service_key)),
    description: str(r.description),
    project_id: str(r.project_id),
    app_id: str(r.app_id),
    sender_id: str(r.sender_id),
    web_api_key: str(r.web_api_key),
    server_key: str(r.server_key),
    service_account_json: typeof r.service_account_json === "string"
      ? r.service_account_json
      : r.service_account_json
        ? JSON.stringify(r.service_account_json, null, 2)
        : "",
    is_active: bool(r.is_active),
    is_test_mode: bool(r.is_test_mode),
    priority: num(r.priority),
  };
}

export default function FirebasePage() {
  const [list, setList] = useState<Service[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin-table", "firebase_services"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/firebase_services?order=priority")).map(parse),
  });

  useEffect(() => {
    if (q.data) setList(q.data);
  }, [q.data]);

  const update = (id: string, patch: Partial<Service>) =>
    setList((p) => p.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const save = async (g: Service) => {
    setSavingId(g.id);
    setErr(null);
    try {
      await apiFetch(`/v1/admin/table/firebase_services?id=${encodeURIComponent(g.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          project_id: g.project_id,
          app_id: g.app_id,
          sender_id: g.sender_id,
          web_api_key: g.web_api_key,
          server_key: g.server_key,
          service_account_json: g.service_account_json,
          is_active: g.is_active,
          is_test_mode: g.is_test_mode,
          priority: g.priority,
        }),
      });
      await q.refetch();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save fail");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <>
      <PageHeader title="Firebase Services" subtitle="FCM, Auth, Analytics — keys DB se" />
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
      ) : list.length === 0 ? (
        <GoldCard className="p-12 text-center text-sm text-[#d4af37]/70">
          firebase_services me koi row nahi mili.
        </GoldCard>
      ) : (
        <div className="grid gap-4">
          {list.map((g) => (
            <GoldCard key={g.id} className="p-5">
              <div className="flex items-start justify-between mb-4 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-11 w-11 rounded-xl grid place-items-center shrink-0"
                    style={{ background: "linear-gradient(180deg,#ffb648,#ff7a18,#a13b00)" }}
                  >
                    <Flame className="h-5 w-5 text-[#1a1208]" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-bold admin-title truncate">{g.display_name}</h3>
                    <p className="text-[10px] uppercase tracking-wider text-[#d4af37]/70">{g.service_key}</p>
                  </div>
                </div>
                <span
                  className={`text-[9px] uppercase tracking-wider px-2 py-1 rounded-full font-bold ${
                    g.is_active ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "border"
                  }`}
                >
                  {g.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Project ID" value={g.project_id} onChange={(v) => update(g.id, { project_id: v })} />
                <Field label="App ID" value={g.app_id} onChange={(v) => update(g.id, { app_id: v })} />
                <Field label="Sender ID" value={g.sender_id} onChange={(v) => update(g.id, { sender_id: v })} />
                <Field label="Web API Key" value={g.web_api_key} onChange={(v) => update(g.id, { web_api_key: v })} />
              </div>
              {g.service_key === "fcm" && (
                <Field
                  label="Server Key (Legacy)"
                  value={g.server_key}
                  onChange={(v) => update(g.id, { server_key: v })}
                  secret
                  className="mt-3"
                />
              )}
              <label className="text-[10px] uppercase tracking-wider font-bold block mt-3" style={{ color: "var(--admin-muted)" }}>
                Service Account JSON
                <textarea
                  rows={4}
                  value={g.service_account_json}
                  onChange={(e) => update(g.id, { service_account_json: e.target.value })}
                  className={`${inputCls} mt-1 font-mono text-[11px]`}
                />
              </label>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <GoldToggle label="Test" value={g.is_test_mode} onChange={(v) => update(g.id, { is_test_mode: v })} />
                <GoldToggle label="Active" value={g.is_active} onChange={(v) => update(g.id, { is_active: v })} />
              </div>
              <GoldButton onClick={() => save(g)} disabled={savingId === g.id} className="w-full mt-3">
                <Save className="h-3.5 w-3.5 inline mr-1.5" />
                {savingId === g.id ? "Saving…" : "Save keys"}
              </GoldButton>
            </GoldCard>
          ))}
        </div>
      )}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  secret,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secret?: boolean;
  className?: string;
}) {
  return (
    <label className={`text-[10px] uppercase tracking-wider font-bold block ${className}`} style={{ color: "var(--admin-muted)" }}>
      {label}
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputCls} mt-1 font-mono text-xs`}
      />
    </label>
  );
}
