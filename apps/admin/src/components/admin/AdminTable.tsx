import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { apiFetch, asList, str } from "@/lib/api";
import { ErrorBanner } from "./ErrorBanner";
import { GoldButton, GoldCard, PageHeader } from "./AdminLayout";

function cell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function tableName(endpoint: string) {
  const parts = endpoint.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? endpoint;
}

export function AdminTable({
  title,
  subtitle,
  endpoint,
  columns,
}: {
  title: string;
  subtitle?: string;
  endpoint: string;
  columns?: { key: string; label: string }[];
}) {
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const table = tableName(endpoint);

  const query = useQuery({
    queryKey: ["admin-table", endpoint],
    queryFn: async () => asList(await apiFetch(endpoint)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      apiFetch(`/v1/admin/table/${table}?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-table", endpoint] }),
  });

  const cols = useMemo(() => {
    if (columns?.length) return columns;
    const first = query.data?.[0];
    if (!first) return [];
    const keys = Object.keys(first).filter((k) => !["password", "secret", "secret_key"].includes(k));
    const preferred = [
      "name",
      "display_name",
      "title",
      "email",
      "phone",
      "status",
      "provider",
      "is_active",
      "created_at",
    ];
    const ordered = [
      ...preferred.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !preferred.includes(k)),
    ].slice(0, 7);
    return ordered.map((key) => ({
      key,
      label: key.replace(/_/g, " "),
    }));
  }, [columns, query.data]);

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(s)),
    );
  }, [query.data, q]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setFormErr(null);
    try {
      const id = draft.id ? String(draft.id) : "";
      const body = { ...draft };
      if (id) {
        await apiFetch(`/v1/admin/table/${table}?id=${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        delete body.id;
        await apiFetch(`/v1/admin/table/${table}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["admin-table", endpoint] });
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={
          subtitle ??
          (query.isLoading
            ? "Loading…"
            : `${filtered.length} record${filtered.length === 1 ? "" : "s"}`)
        }
        action={
          <div className="flex gap-2">
            <GoldButton
              onClick={() => {
                setFormErr(null);
                setDraft({ name: "", is_active: true });
              }}
            >
              <Plus className="h-3.5 w-3.5 inline mr-1.5" />
              Add
            </GoldButton>
            <GoldButton variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 inline mr-1.5 ${query.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </GoldButton>
          </div>
        }
      />

      <GoldCard className="p-3 mb-4">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#d4af37]/70" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-black/30 border border-[#d4af37]/30 text-[#f5d97a] placeholder:text-[#f5d97a]/40 focus:outline-none focus:border-[#d4af37]"
            />
          </div>
          <GoldButton variant="outline" onClick={() => setQ("")}>
            Clear
          </GoldButton>
        </div>
      </GoldCard>

      {query.isError && (
        <div className="mb-4">
          <ErrorBanner
            message={query.error instanceof Error ? query.error.message : "Load fail"}
            onRetry={() => query.refetch()}
          />
        </div>
      )}

      {draft && (
        <GoldCard className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-[0.2em] text-[#d4af37] font-bold">
              {draft.id ? "Edit row" : "New row"}
            </p>
            <button type="button" onClick={() => setDraft(null)} className="text-[#f5d97a]/70">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {["name", "title", "slug", "phone", "email", "provider", "status"].map((key) => (
              <label key={key} className="text-[10px] uppercase tracking-wider text-[#d4af37]/70">
                {key}
                <input
                  value={str(draft[key])}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-black/30 border border-[#d4af37]/30 text-[#fff8dc]"
                />
              </label>
            ))}
          </div>
          {formErr && <p className="text-xs text-red-300 mt-2">{formErr}</p>}
          <div className="flex gap-2 mt-3">
            <GoldButton onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </GoldButton>
            <GoldButton variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </GoldButton>
          </div>
        </GoldCard>
      )}

      {query.isLoading ? (
        <GoldCard className="p-16 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </GoldCard>
      ) : filtered.length === 0 ? (
        <GoldCard className="p-12 text-center">
          <p className="text-[#f5d97a]/60">
            {query.data?.length ? "No matches" : "Koi record nahi mila. Add se naya row banayein."}
          </p>
        </GoldCard>
      ) : (
        <GoldCard className="overflow-x-auto">
          <table className="w-full text-left min-w-[640px]">
            <thead>
              <tr className="border-b border-[#d4af37]/20">
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className="px-3 py-3 text-[10px] uppercase tracking-[0.2em] text-[#d4af37]/70 font-bold"
                  >
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-3 text-[10px] uppercase tracking-[0.2em] text-[#d4af37]/70 font-bold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={str(row.id, String(i))} className="border-b border-[#d4af37]/10 last:border-0">
                  {cols.map((c) => (
                    <td key={c.key} className="px-3 py-3 text-xs text-[#fff8dc] max-w-[240px] truncate">
                      {c.key.includes("active") || c.key === "is_active" ? (
                        <span
                          className={`text-[9px] uppercase tracking-wider px-2 py-1 rounded-full font-bold ${
                            row[c.key]
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-black/40 text-[#d4af37]/60 border border-[#d4af37]/20"
                          }`}
                        >
                          {row[c.key] ? "Active" : "Inactive"}
                        </span>
                      ) : (
                        cell(row[c.key])
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-[#f5d97a] mr-2"
                      onClick={() => {
                        setFormErr(null);
                        setDraft({ ...row });
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 inline" />
                    </button>
                    <button
                      type="button"
                      className="text-red-300"
                      onClick={() => {
                        const id = str(row.id);
                        if (id && confirm("Delete this row?")) remove.mutate(id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 inline" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </GoldCard>
      )}
    </div>
  );
}
