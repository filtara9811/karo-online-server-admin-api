import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { MessageCircle, Phone, ShoppingBag, Star } from "lucide-react";
import { api, str, unwrapRecord } from "@/lib/api";

type Landing = {
  name?: string;
  title?: string;
  description?: string;
  phone?: string;
  whatsapp?: string;
  trade?: string;
  is_online?: boolean;
  products?: { id: string; name: string; price: number; category?: string }[];
  stats?: { views?: number; products?: number; rating?: number };
  visit_count?: number;
};

export default function ShopLandingPage() {
  const { code = "" } = useParams();
  const [params] = useSearchParams();
  const [landing, setLanding] = useState<Landing | null>(null);
  const [gate, setGate] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [chat, setChat] = useState("");
  const [sent, setSent] = useState(false);
  const [ordered, setOrdered] = useState<string | null>(null);

  useEffect(() => {
    const ref = params.get("ref");
    if (ref) {
      try {
        localStorage.setItem("ko-pending-referral", ref);
      } catch {
        /* ignore */
      }
    }
    api<Landing>(`/v1/shops/${encodeURIComponent(code)}/landing?kind=s${params.get("p") ? `&p=${encodeURIComponent(params.get("p") ?? "")}` : ""}`)
      .then((row) => {
        const landing = unwrapRecord(row) as Landing;
        setLanding(landing);
        document.title = `${landing.name || landing.title || code} — Karo Online`;
      })
      .catch(() => setLanding({ name: code, products: [] }));
    api(`/v1/shops/${encodeURIComponent(code)}/visit`, {
      method: "POST",
      body: JSON.stringify({ kind: "s", source: "qr" }),
    }).catch(() => undefined);
    const seen = sessionStorage.getItem(`ko-gate-${code}`);
    if (!seen && params.get("embed") !== "1") setGate(true);
  }, [code, params]);

  const shop = landing?.name || landing?.title || code;
  const products = landing?.products ?? [];
  const wa = String(landing?.whatsapp || landing?.phone || "").replace(/\D/g, "");
  const install = useMemo(() => {
    const manifest = `/api/public/manifest/${encodeURIComponent(code)}`;
    return manifest;
  }, [code]);

  useEffect(() => {
    const link = document.querySelector("link[rel=manifest]") ?? document.createElement("link");
    link.setAttribute("rel", "manifest");
    link.setAttribute("href", install);
    document.head.appendChild(link);
  }, [install]);

  const saveGate = async () => {
    sessionStorage.setItem(`ko-gate-${code}`, "1");
    await api(`/v1/shops/${encodeURIComponent(code)}/visit`, {
      method: "POST",
      body: JSON.stringify({ kind: "s", source: "qr", visitor_name: name, visitor_phone: phone }),
    }).catch(() => undefined);
    setGate(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="sticky top-0 z-20 ko-glass">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-display text-lg"><span className="ko-gold-text">Karo</span>Online</Link>
          <span className={`text-xs ${landing?.is_online ? "text-emerald-400" : "text-white/50"}`}>{landing?.is_online ? "Online" : "Shop"}</span>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 pb-28">
        <div className="h-40 rounded-3xl ko-gold-bar grid place-items-center mb-5">
          <div className="h-20 w-20 rounded-2xl bg-[#1a1208] text-[#f5d97a] grid place-items-center font-display text-4xl">
            {shop.slice(0, 1).toUpperCase()}
          </div>
        </div>
        <h1 className="font-display text-4xl">{shop}</h1>
        <p className="text-white/55 mt-1">{landing?.trade || "Verified shop on Karo Online"}</p>
        <p className="text-white/70 mt-4">{landing?.description}</p>
        <div className="flex gap-4 mt-4 text-xs text-white/50">
          <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-[#f5d97a]" /> {landing?.stats?.rating ?? 4.8}</span>
          <span>{landing?.stats?.views ?? landing?.visit_count ?? 1} views</span>
          <span>{products.length} products</span>
        </div>

        <div className="flex gap-2 mt-6">
          {wa && (
            <a href={`https://wa.me/${wa}`} className="flex-1 ko-gold-bar rounded-xl py-3 text-center font-semibold inline-flex items-center justify-center gap-2">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          )}
          {landing?.phone && (
            <a href={`tel:+91${landing.phone}`} className="flex-1 border border-white/15 rounded-xl py-3 text-center font-semibold inline-flex items-center justify-center gap-2">
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
        </div>

        <h2 className="font-display text-2xl mt-10 mb-3 flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-[#f5d97a]" /> Shop</h2>
        <div className="grid gap-3">
          {products.map((p) => (
            <div key={p.id} className="ko-glass rounded-2xl px-4 py-3 flex items-center justify-between">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-white/45">{p.category}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="text-[#f5d97a] font-bold">₹{p.price}</div>
                <button
                  className="text-[11px] font-semibold text-[#f5d97a]"
                  onClick={() => {
                    api(`/v1/shops/${encodeURIComponent(code)}/orders`, {
                      method: "POST",
                      body: JSON.stringify({
                        project: params.get("p"),
                        visitor_name: name || undefined,
                        visitor_phone: phone || undefined,
                        items: [{ id: p.id, name: p.name, price: p.price, qty: 1 }],
                      }),
                    })
                      .then(() => setOrdered(p.id))
                      .catch(() => setOrdered(p.id));
                  }}
                >
                  {ordered === p.id ? "Noted" : "Order"}
                </button>
              </div>
            </div>
          ))}
          {products.length === 0 && <p className="text-white/45 text-sm">Products will appear when the merchant adds them.</p>}
        </div>

        <h2 className="font-display text-2xl mt-10 mb-3">Ask this shop</h2>
        {sent ? (
          <p className="text-[#f5d97a]">Message noted. Open the app to continue the chat.</p>
        ) : (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSent(true);
            }}
          >
            <textarea className="rounded-xl bg-black/30 border border-white/10 px-3 py-2 min-h-24" value={chat} onChange={(e) => setChat(e.target.value)} placeholder="I want to order…" />
            <button className="ko-gold-bar rounded-xl py-3 font-semibold">Send inquiry</button>
          </form>
        )}
      </main>

      {gate && (
        <div className="fixed inset-0 bg-black/70 grid place-items-end sm:place-items-center z-40 p-4">
          <div className="w-full max-w-md ko-glass rounded-3xl p-6 bg-[#12100a]">
            <h3 className="font-display text-2xl">Welcome to {shop}</h3>
            <p className="text-white/55 text-sm mt-1">Leave your name so the shop can recognise you next time.</p>
            <input className="mt-4 w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="mt-2 w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button onClick={saveGate} className="mt-4 w-full ko-gold-bar rounded-xl py-3 font-semibold">Continue</button>
            <button onClick={() => { sessionStorage.setItem(`ko-gate-${code}`, "1"); setGate(false); }} className="mt-2 w-full text-sm text-white/45">Skip</button>
          </div>
        </div>
      )}
    </div>
  );
}
