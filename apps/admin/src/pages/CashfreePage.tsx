import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save, Zap } from "lucide-react";
import { apiFetch, asList, bool, num, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, GoldToggle, PageHeader, inputCls } from "@/components/admin/AdminLayout";

type Row = {
  id: string;
  service_key: string;
  display_name: string;
  description: string;
  app_id: string;
  secret_key: string;
  is_active: boolean;
  is_test_mode: boolean;
  priority: number;
};

function parse(r: Record<string, unknown>): Row {
  return {
    id: str(r.id),
    service_key: str(r.service_key),
    display_name: str(r.display_name, str(r.service_key)),
    description: str(r.description),
    app_id: str(r.app_id),
    secret_key: str(r.secret_key),
    is_active: bool(r.is_active),
    is_test_mode: bool(r.is_test_mode),
    priority: num(r.priority),
  };
}

export default function CashfreePage() {
  const [list, setList] = useState<Row[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin-table", "cashfree_services"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/cashfree_services?order=priority")).map(parse),
  });

  useEffect(() => {
    if (q.data) setList(q.data);
  }, [q.data]);

  const update = (id: string, patch: Partial<Row>) =>
    setList((p) => p.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const save = async (g: Row) => {
    setSavingId(g.id);
    setErr(null);
    try {
      await apiFetch(`/v1/admin/table/cashfree_services?id=${encodeURIComponent(g.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          app_id: g.app_id,
          secret_key: g.secret_key,
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
      <PageHeader title="Cashfree Services" subtitle="App ID + secret keys DB se" />
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
          cashfree_services me koi row nahi mili.
        </GoldCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {list.map((g) => (
            <GoldCard key={g.id} className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="h-11 w-11 rounded-xl grid place-items-center"
                  style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
                >
                  <Zap className="h-5 w-5 text-[#1a1208]" />
                </div>
                <div>
                  <p className="font-display font-bold">{g.display_name}</p>
                  <p className="text-[10px] uppercase tracking-wider text-[#d4af37]/70">{g.service_key}</p>
                </div>
              </div>
              <label className="text-[10px] uppercase tracking-wider font-bold block mb-3" style={{ color: "var(--admin-muted)" }}>
                App ID
                <input value={g.app_id} onChange={(e) => update(g.id, { app_id: e.target.value })} className={`${inputCls} mt-1 font-mono text-xs`} />
              </label>
              <label className="text-[10px] uppercase tracking-wider font-bold block mb-3" style={{ color: "var(--admin-muted)" }}>
                Secret Key
                <input value={g.secret_key} onChange={(e) => update(g.id, { secret_key: e.target.value })} className={`${inputCls} mt-1 font-mono text-xs`} />
              </label>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <GoldToggle label="Test" value={g.is_test_mode} onChange={(v) => update(g.id, { is_test_mode: v })} />
                <GoldToggle label="Active" value={g.is_active} onChange={(v) => update(g.id, { is_active: v })} />
              </div>
              <GoldButton onClick={() => save(g)} disabled={savingId === g.id} className="w-full">
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
