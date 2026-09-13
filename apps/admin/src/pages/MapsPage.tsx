import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Save } from "lucide-react";
import { apiFetch, asList, bool, num, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, GoldToggle, PageHeader, inputCls } from "@/components/admin/AdminLayout";

const ASSIGNMENTS = [
  { v: "none", l: "Not Assigned" },
  { v: "geocoding", l: "Geocoding" },
  { v: "reverse_geocoding", l: "Reverse Geocoding" },
  { v: "autocomplete", l: "Places Autocomplete" },
  { v: "nearby", l: "Nearby Search" },
  { v: "directions", l: "Directions / Routing" },
  { v: "static_map", l: "Static Map Image" },
  { v: "all", l: "All (Default Provider)" },
] as const;

type Service = {
  id: string;
  provider: string;
  display_name: string;
  description: string;
  api_key: string;
  rest_key: string;
  map_sdk_key: string;
  client_id: string;
  client_secret: string;
  assigned_use: string;
  is_active: boolean;
  is_test_mode: boolean;
  priority: number;
};

function parse(r: Record<string, unknown>): Service {
  return {
    id: str(r.id),
    provider: str(r.provider),
    display_name: str(r.display_name, str(r.provider)),
    description: str(r.description),
    api_key: str(r.api_key),
    rest_key: str(r.rest_key),
    map_sdk_key: str(r.map_sdk_key),
    client_id: str(r.client_id),
    client_secret: str(r.client_secret),
    assigned_use: str(r.assigned_use, "all"),
    is_active: bool(r.is_active),
    is_test_mode: bool(r.is_test_mode),
    priority: num(r.priority),
  };
}

export default function MapsPage() {
  const [list, setList] = useState<Service[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin-table", "maps_services"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/maps_services?order=priority")).map(parse),
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
      await apiFetch(`/v1/admin/table/maps_services?id=${encodeURIComponent(g.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          api_key: g.api_key,
          rest_key: g.rest_key,
          map_sdk_key: g.map_sdk_key,
          client_id: g.client_id,
          client_secret: g.client_secret,
          assigned_use: g.assigned_use,
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
      <PageHeader
        title="Maps Providers"
        subtitle="Keys DB se load ho rahi hain — Google Maps & Mappls"
      />
      <GoldCard className="p-4 mb-4">
        <p className="text-xs leading-relaxed" style={{ color: "var(--admin-muted)" }}>
          Live <b>maps_services</b> table. App inhi keys se geocode / nearby / directions chalata hai.
        </p>
      </GoldCard>
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
          maps_services me koi row nahi mili.
        </GoldCard>
      ) : (
        <div className="grid gap-4">
          {list.map((g) => (
            <GoldCard key={g.id} className="p-5">
              <div className="flex items-start justify-between mb-4 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-11 w-11 rounded-xl grid place-items-center shrink-0"
                    style={{ background: "linear-gradient(180deg,#a7f3d0,#10b981,#064e3b)" }}
                  >
                    <MapPin className="h-5 w-5 text-[#0f1c14]" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-bold admin-title truncate">{g.display_name}</h3>
                    {g.description && (
                      <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--admin-muted)" }}>
                        {g.description}
                      </p>
                    )}
                    <p className="text-[10px] uppercase tracking-wider text-[#d4af37]/70">{g.provider}</p>
                  </div>
                </div>
                <span
                  className={`text-[9px] uppercase tracking-wider px-2 py-1 rounded-full font-bold ${
                    g.is_active ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "border"
                  }`}
                  style={!g.is_active ? { color: "var(--admin-muted)", borderColor: "var(--admin-card-border)" } : undefined}
                >
                  {g.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="API Key (REST)" value={g.api_key} onChange={(v) => update(g.id, { api_key: v })} />
                <Field label="REST Key" value={g.rest_key} onChange={(v) => update(g.id, { rest_key: v })} />
                <Field label="Map SDK Key" value={g.map_sdk_key} onChange={(v) => update(g.id, { map_sdk_key: v })} />
                {g.provider === "mappls" && (
                  <>
                    <Field label="Client ID" value={g.client_id} onChange={(v) => update(g.id, { client_id: v })} />
                    <Field label="Client Secret" value={g.client_secret} onChange={(v) => update(g.id, { client_secret: v })} secret />
                  </>
                )}
              </div>
              <div className="grid sm:grid-cols-3 gap-3 mt-3">
                <label className="text-[10px] uppercase tracking-wider font-bold block" style={{ color: "var(--admin-muted)" }}>
                  Assigned use
                  <select
                    value={g.assigned_use}
                    onChange={(e) => update(g.id, { assigned_use: e.target.value })}
                    className={`${inputCls} mt-1`}
                  >
                    {ASSIGNMENTS.map((a) => (
                      <option key={a.v} value={a.v}>
                        {a.l}
                      </option>
                    ))}
                  </select>
                </label>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secret?: boolean;
}) {
  return (
    <label className="text-[10px] uppercase tracking-wider font-bold block" style={{ color: "var(--admin-muted)" }}>
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
