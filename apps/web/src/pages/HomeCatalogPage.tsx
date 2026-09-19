import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Store } from "lucide-react";
import { api, asList, str } from "@/lib/api";

type Shop = {
  id: string;
  business_name: string;
  trade?: string | null;
  slug?: string | null;
};

export default function HomeCatalogPage() {
  const [shops, setShops] = useState<Shop[]>([]);

  useEffect(() => {
    document.title = "Digital shops — Karo Online";
    api("/v1/shops/nearby")
      .then((raw) => {
        const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const list = asList(rec.shops ?? rec);
        setShops(
          list.map((r) => ({
            id: str(r.id),
            business_name: str(r.business_name ?? r.name, "Shop"),
            trade: r.trade == null ? null : str(r.trade),
            slug: r.slug == null ? null : str(r.slug),
          })),
        );
      })
      .catch(() => setShops([]));
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="sticky top-0 z-20 ko-glass">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-display text-lg">
            <span className="ko-gold-text">Karo</span>Online
          </Link>
          <span className="text-xs text-white/50">Digital shop catalog</span>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">
        <h1 className="font-display text-4xl">Shops</h1>
        <p className="text-white/55 mt-1">Browse public storefronts. Scan a Grow QR to open a shop PWA.</p>
        <div className="grid gap-3 mt-6">
          {shops.map((s) => (
            <Link
              key={s.id}
              to={`/s/${encodeURIComponent(s.slug || s.id)}`}
              className="ko-glass rounded-2xl px-4 py-3 flex items-center gap-3"
            >
              <span className="h-11 w-11 rounded-xl ko-gold-bar grid place-items-center">
                <Store className="h-5 w-5" />
              </span>
              <div>
                <div className="font-semibold">{s.business_name}</div>
                <div className="text-xs text-white/45">{s.trade || "Local shop"}</div>
              </div>
            </Link>
          ))}
          {shops.length === 0 && <p className="text-white/45 text-sm">No public shops yet. Merchants publish from Assan Grow.</p>}
        </div>
      </main>
    </div>
  );
}
