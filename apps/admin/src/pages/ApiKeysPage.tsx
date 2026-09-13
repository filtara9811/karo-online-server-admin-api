import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon, Instagram, Loader2, Save } from "lucide-react";
import { apiFetch, asList, asRecord, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader, inputCls } from "@/components/admin/AdminLayout";

type Config = {
  instagram_key: string;
  instagram_host: string;
  instagram_path: string;
  pinterest_key: string;
  pinterest_host: string;
  pinterest_path: string;
};

const EMPTY: Config = {
  instagram_key: "",
  instagram_host: "instagram-scraper-stable-api.p.rapidapi.com",
  instagram_path: "/get_ig_user_reels.php",
  pinterest_key: "",
  pinterest_host: "pinterest-scraper5.p.rapidapi.com",
  pinterest_path: "/pins",
};

export default function ApiKeysPage() {
  const [cfg, setCfg] = useState<Config>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-table", "app_settings"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/app_settings")),
  });

  useEffect(() => {
    if (!q.data) return;
    const row = q.data.find((r) => str(r.key) === "rapidapi_config");
    const v = row ? (asRecord(row.value) as Partial<Config>) : {};
    setCfg({ ...EMPTY, ...v });
  }, [q.data]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      await apiFetch("/v1/admin/table/app_settings", {
        method: "POST",
        body: JSON.stringify({ key: "rapidapi_config", value: cfg }),
      });
      setOk("API keys saved");
      await q.refetch();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save fail");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="text-[10px] uppercase tracking-wider font-bold block" style={{ color: "var(--admin-muted)" }}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} mt-1 font-mono text-xs`} />
    </label>
  );

  return (
    <>
      <PageHeader title="API Management" subtitle="RapidAPI keys — Instagram & Pinterest auto-feed (app_settings)" />
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
      {ok && (
        <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{ok}</div>
      )}
      {q.isLoading ? (
        <GoldCard className="p-16 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </GoldCard>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <GoldCard className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Instagram className="h-4 w-4 text-[#d4af37]" />
                <h3 className="font-semibold">Instagram Scraper</h3>
              </div>
              {field("RapidAPI Key", cfg.instagram_key, (v) => setCfg((p) => ({ ...p, instagram_key: v })))}
              {field("API Host", cfg.instagram_host, (v) => setCfg((p) => ({ ...p, instagram_host: v })))}
              {field("Endpoint Path", cfg.instagram_path, (v) => setCfg((p) => ({ ...p, instagram_path: v })))}
            </GoldCard>
            <GoldCard className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-[#d4af37]" />
                <h3 className="font-semibold">Pinterest Scraper</h3>
              </div>
              {field("RapidAPI Key", cfg.pinterest_key, (v) => setCfg((p) => ({ ...p, pinterest_key: v })))}
              {field("API Host", cfg.pinterest_host, (v) => setCfg((p) => ({ ...p, pinterest_host: v })))}
              {field("Endpoint Path", cfg.pinterest_path, (v) => setCfg((p) => ({ ...p, pinterest_path: v })))}
            </GoldCard>
          </div>
          <GoldButton onClick={save} disabled={saving} className="mt-4">
            <Save className="h-3.5 w-3.5 inline mr-1.5" />
            {saving ? "Saving…" : "Save keys"}
          </GoldButton>
        </>
      )}
    </>
  );
}
