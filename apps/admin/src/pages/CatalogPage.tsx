import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderTree, Layers, Package, ChevronRight, Loader2, ArrowLeft } from "lucide-react";
import { apiFetch, asList, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader } from "@/components/admin/AdminLayout";

export default function CatalogPage() {
  const [typeId, setTypeId] = useState<string | null>(null);
  const [catId, setCatId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const typesQ = useQuery({
    queryKey: ["admin-table", "catalog_types"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/catalog_types")),
  });
  const catsQ = useQuery({
    queryKey: ["admin-table", "categories"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/categories")),
  });
  const itemsQ = useQuery({
    queryKey: ["admin-table", "catalog_items"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/catalog_items")),
  });

  const types = typesQ.data ?? [];
  const categories = catsQ.data ?? [];
  const items = itemsQ.data ?? [];
  const err = typesQ.error || catsQ.error || itemsQ.error;
  const loading = typesQ.isLoading || catsQ.isLoading || itemsQ.isLoading;

  const visibleCats = useMemo(
    () =>
      categories.filter((c) => {
        if (typeId && str(c.type_id) !== typeId) return false;
        return !c.parent_id || str(c.parent_id) === str(typeId);
      }),
    [categories, typeId],
  );

  const visibleItems = useMemo(
    () => items.filter((i) => !catId || str(i.category_id) === catId),
    [items, catId],
  );

  const subtitle = catId
    ? "Items in selected category"
    : typeId
      ? "Categories in selected type"
      : "Catalog types → categories → items";

  return (
    <>
      <PageHeader
        title="Catalog Manager"
        subtitle={subtitle}
        action={
          (typeId || catId) ? (
            <GoldButton
              variant="outline"
              onClick={() => {
                if (catId) setCatId(null);
                else setTypeId(null);
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5 inline mr-1" /> Back
            </GoldButton>
          ) : undefined
        }
      />

      <GoldCard className="p-3 mb-4">
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={catId ? "New item name" : typeId ? "New category name" : "New catalog type"}
            className="flex-1 px-3 py-2.5 rounded-lg bg-black/30 border border-[#d4af37]/30 text-[#fff8dc]"
          />
          <GoldButton
            disabled={saving || !newName.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                const table = catId ? "catalog_items" : typeId ? "categories" : "catalog_types";
                const slug = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
                await apiFetch(`/v1/admin/table/${table}`, {
                  method: "POST",
                  body: JSON.stringify({
                    name: newName.trim(),
                    slug,
                    is_active: true,
                    type_id: typeId,
                    category_id: catId,
                    parent_id: typeId && !catId ? null : undefined,
                  }),
                });
                setNewName("");
                await Promise.all([typesQ.refetch(), catsQ.refetch(), itemsQ.refetch()]);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Add"}
          </GoldButton>
        </div>
      </GoldCard>

      {err && (
        <div className="mb-4">
          <ErrorBanner
            message={err instanceof Error ? err.message : "Catalog load fail"}
            onRetry={() => {
              typesQ.refetch();
              catsQ.refetch();
              itemsQ.refetch();
            }}
          />
        </div>
      )}

      {loading ? (
        <GoldCard className="p-16 grid place-items-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </GoldCard>
      ) : !typeId ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {types.map((t) => (
            <button key={str(t.id)} type="button" onClick={() => setTypeId(str(t.id))} className="text-left">
              <GoldCard className="p-4 hover:border-[#d4af37]/60 transition">
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-xl grid place-items-center"
                    style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
                  >
                    <FolderTree className="h-5 w-5 text-[#1a1208]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-bold text-[#fff8dc] truncate">{str(t.name, str(t.code))}</p>
                    <p className="text-[10px] uppercase tracking-wider text-[#d4af37]/60">{str(t.code)}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[#d4af37]/50" />
                </div>
              </GoldCard>
            </button>
          ))}
          {types.length === 0 && (
            <GoldCard className="p-8 col-span-full text-center text-[#f5d97a]/60 text-sm">
              Koi catalog type nahi mila.
            </GoldCard>
          )}
        </div>
      ) : !catId ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleCats.map((c) => (
            <button key={str(c.id)} type="button" onClick={() => setCatId(str(c.id))} className="text-left">
              <GoldCard className="p-4 hover:border-[#d4af37]/60 transition">
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-xl grid place-items-center"
                    style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
                  >
                    <Layers className="h-5 w-5 text-[#1a1208]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-bold text-[#fff8dc] truncate">{str(c.name)}</p>
                    <p className="text-[10px] text-[#d4af37]/60 truncate">{str(c.slug)}</p>
                  </div>
                  <span
                    className={`text-[9px] uppercase px-2 py-0.5 rounded-full font-bold ${
                      bool(c.is_active)
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-black/40 text-[#d4af37]/60"
                    }`}
                  >
                    {bool(c.is_active) ? "Live" : "Off"}
                  </span>
                </div>
              </GoldCard>
            </button>
          ))}
          {visibleCats.length === 0 && (
            <GoldCard className="p-8 col-span-full text-center text-[#f5d97a]/60 text-sm">
              Is type mein koi category nahi.
            </GoldCard>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleItems.map((i) => (
            <GoldCard key={str(i.id)} className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-xl grid place-items-center"
                  style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
                >
                  <Package className="h-5 w-5 text-[#1a1208]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[#fff8dc] truncate">{str(i.name)}</p>
                  <p className="text-xs text-[#f5d97a]/60 truncate">{str(i.description)}</p>
                </div>
                <p className="text-xs text-[#f5d97a]">
                  {i.price_min != null || i.price_max != null
                    ? `₹${i.price_min ?? "?"}–${i.price_max ?? "?"}`
                    : "—"}
                </p>
              </div>
            </GoldCard>
          ))}
          {visibleItems.length === 0 && (
            <GoldCard className="p-8 text-center text-[#f5d97a]/60 text-sm">
              Is category mein koi item nahi.
            </GoldCard>
          )}
        </div>
      )}
    </>
  );
}
