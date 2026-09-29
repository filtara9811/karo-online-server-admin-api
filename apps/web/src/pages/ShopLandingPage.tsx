import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { MessageCircle, Phone, ShoppingBag } from "lucide-react";
import { api, unwrapRecord } from "@/lib/api";

type Product = { id: string; name: string; price: number; category?: string | null; stock?: number; image_url?: string | null };

type Landing = {
  name?: string;
  title?: string;
  description?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  trade?: string | null;
  city?: string | null;
  project?: string | null;
  avatar_url?: string | null;
  cover_image_url?: string | null;
  products?: Product[];
  stats?: { views?: number; products?: number };
};

type Visitor = { name: string; phone: string };

const VISITOR_KEY = "ko-visitor";
const validPhone = (p: string) => /^[6-9]\d{9}$/.test(p.replace(/\D/g, "").slice(-10));

function savedVisitor(): Visitor | null {
  try {
    const v = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? "null") as Visitor | null;
    return v && v.name && validPhone(v.phone) ? v : null;
  } catch {
    return null;
  }
}

export default function ShopLandingPage() {
  const { code = "" } = useParams();
  const [params] = useSearchParams();
  const project = params.get("p") ?? "";
  const [landing, setLanding] = useState<Landing | null>(null);
  const [gate, setGate] = useState(false);
  const [visitor, setVisitor] = useState<Visitor | null>(() => savedVisitor());
  const [name, setName] = useState(visitor?.name ?? "");
  const [phone, setPhone] = useState(visitor?.phone ?? "");
  const [gateError, setGateError] = useState("");
  const [chat, setChat] = useState("");
  const [chatState, setChatState] = useState<{ busy?: boolean; sent?: boolean; error?: string }>({});
  const [orders, setOrders] = useState<Record<string, "busy" | "done" | string>>({});
  const visitId = useRef<string | null>(null);

  useEffect(() => {
    const ref = params.get("ref");
    if (ref) {
      try {
        localStorage.setItem("ko-pending-referral", ref);
      } catch {
        /* ignore */
      }
    }
    const q = new URLSearchParams({ kind: "s" });
    if (project) q.set("p", project);
    api<Landing>(`/v1/shops/${encodeURIComponent(code)}/landing?${q}`)
      .then((row) => {
        const l = unwrapRecord(row) as Landing;
        setLanding(l);
        document.title = `${l.name || l.title || code} — Karo Online`;
      })
      .catch(() => setLanding({ name: code, products: [] }));

    const sessionKey = `ko-visit-${code}-${project}`;
    const known = savedVisitor();
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, "1");
      api<{ visit?: { id?: string } }>(`/v1/shops/${encodeURIComponent(code)}/visit`, {
        method: "POST",
        body: JSON.stringify({
          kind: "s",
          source: params.get("utm_source") || "qr",
          project: project || undefined,
          ...(known ? { visitor_name: known.name, visitor_phone: known.phone } : {}),
        }),
      })
        .then((r) => {
          visitId.current = r?.visit?.id ?? null;
        })
        .catch(() => undefined);
      if (!known && params.get("embed") !== "1") setGate(true);
    }
  }, [code, project, params]);

  const shop = landing?.name || landing?.title || code;
  const products = landing?.products ?? [];
  const digits = String(landing?.whatsapp || landing?.phone || "").replace(/\D/g, "").slice(-10);
  const wa = digits.length === 10 ? `91${digits}` : "";
  const manifest = useMemo(() => `/api/public/manifest/${encodeURIComponent(code)}`, [code]);

  useEffect(() => {
    const link = document.querySelector("link[rel=manifest]") ?? document.createElement("link");
    link.setAttribute("rel", "manifest");
    link.setAttribute("href", manifest);
    document.head.appendChild(link);
  }, [manifest]);

  const remember = (v: Visitor) => {
    setVisitor(v);
    try {
      localStorage.setItem(VISITOR_KEY, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };

  const saveGate = async () => {
    const v = { name: name.trim(), phone: phone.replace(/\D/g, "").slice(-10) };
    if (!v.name) return setGateError("Enter your name");
    if (!validPhone(v.phone)) return setGateError("Enter a valid 10-digit mobile number");
    setGateError("");
    remember(v);
    setGate(false);
    await api(`/v1/shops/${encodeURIComponent(code)}/visit`, {
      method: "POST",
      body: JSON.stringify({
        kind: "s",
        source: "qr",
        project: project || undefined,
        visit_id: visitId.current ?? undefined,
        visitor_name: v.name,
        visitor_phone: v.phone,
      }),
    }).catch(() => undefined);
  };

  const needVisitor = () => {
    if (visitor) return visitor;
    setGateError("Add your name and mobile so the shop can reply");
    setGate(true);
    return null;
  };

  const order = async (p: Product) => {
    const v = needVisitor();
    if (!v) return;
    setOrders((o) => ({ ...o, [p.id]: "busy" }));
    try {
      await api(`/v1/shops/${encodeURIComponent(code)}/orders`, {
        method: "POST",
        body: JSON.stringify({ project: landing?.project || project || undefined, visitor_name: v.name, visitor_phone: v.phone, items: [{ id: p.id, qty: 1 }] }),
      });
      setOrders((o) => ({ ...o, [p.id]: "done" }));
    } catch (e) {
      setOrders((o) => ({ ...o, [p.id]: e instanceof Error ? e.message : "Could not place the order" }));
    }
  };

  const sendInquiry = async () => {
    const v = needVisitor();
    if (!v) return;
    if (chat.trim().length < 2) return setChatState({ error: "Write your question" });
    setChatState({ busy: true });
    try {
      await api(`/v1/shops/${encodeURIComponent(code)}/inquiry`, {
        method: "POST",
        body: JSON.stringify({ project: landing?.project || project || undefined, visitor_name: v.name, visitor_phone: v.phone, message: chat.trim() }),
      });
      setChatState({ sent: true });
      setChat("");
    } catch (e) {
      setChatState({ error: e instanceof Error ? e.message : "Could not send. Try again." });
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="sticky top-0 z-20 ko-glass">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="font-display text-lg"><span className="ko-gold-text">Karo</span>Online</Link>
          {visitor && <span className="text-xs text-white/50">Hi, {visitor.name.split(" ")[0]}</span>}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 pb-28">
        <div
          className="h-40 rounded-3xl ko-gold-bar grid place-items-center mb-5 bg-cover bg-center"
          style={landing?.cover_image_url ? { backgroundImage: `url(${landing.cover_image_url})` } : undefined}
        >
          {landing?.avatar_url ? (
            <img src={landing.avatar_url} alt="" className="h-20 w-20 rounded-2xl object-cover border border-white/20" />
          ) : (
            <div className="h-20 w-20 rounded-2xl bg-[#1a1208] text-[#f5d97a] grid place-items-center font-display text-4xl">
              {shop.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <h1 className="font-display text-4xl">{shop}</h1>
        <p className="text-white/55 mt-1">{[landing?.trade, landing?.city].filter(Boolean).join(" · ") || "Shop on Karo Online"}</p>
        {landing?.description && <p className="text-white/70 mt-4 whitespace-pre-line">{landing.description}</p>}
        <div className="flex gap-4 mt-4 text-xs text-white/50">
          <span>{landing?.stats?.views ?? 0} visits</span>
          <span>{products.length} products</span>
        </div>

        <div className="flex gap-2 mt-6">
          {wa && (
            <a href={`https://wa.me/${wa}?text=${encodeURIComponent(`Hi ${shop}, I found you on Karo Online.`)}`} className="flex-1 ko-gold-bar rounded-xl py-3 text-center font-semibold inline-flex items-center justify-center gap-2">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          )}
          {digits.length === 10 && (
            <a href={`tel:+91${digits}`} className="flex-1 border border-white/15 rounded-xl py-3 text-center font-semibold inline-flex items-center justify-center gap-2">
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
        </div>

        <h2 className="font-display text-2xl mt-10 mb-3 flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-[#f5d97a]" /> Shop</h2>
        <div className="grid gap-3">
          {products.map((p) => {
            const state = orders[p.id];
            const out = p.stock != null && p.stock <= 0;
            return (
              <div key={p.id} className="ko-glass rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{p.name}</div>
                  <div className="text-xs text-white/45">{out ? "Out of stock" : p.category}</div>
                  {state && state !== "busy" && state !== "done" && <div className="text-xs text-rose-400 mt-1">{state}</div>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="text-[#f5d97a] font-bold">₹{p.price}</div>
                  <button
                    className="text-[11px] font-semibold text-[#f5d97a] disabled:text-white/40"
                    disabled={out || state === "busy" || state === "done"}
                    onClick={() => order(p)}
                  >
                    {state === "done" ? "Order sent" : state === "busy" ? "Sending…" : "Order"}
                  </button>
                </div>
              </div>
            );
          })}
          {products.length === 0 && <p className="text-white/45 text-sm">Products will appear when the shop adds them.</p>}
        </div>

        <h2 className="font-display text-2xl mt-10 mb-3">Ask this shop</h2>
        {chatState.sent ? (
          <p className="text-[#f5d97a]">Question sent. The shop will reply on {visitor?.phone ? `+91 ${visitor.phone}` : "your mobile"}.</p>
        ) : (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sendInquiry();
            }}
          >
            <textarea className="rounded-xl bg-black/30 border border-white/10 px-3 py-2 min-h-24" value={chat} onChange={(e) => setChat(e.target.value)} placeholder="I want to order…" />
            {chatState.error && <p className="text-xs text-rose-400">{chatState.error}</p>}
            <button disabled={chatState.busy} className="ko-gold-bar rounded-xl py-3 font-semibold disabled:opacity-60">{chatState.busy ? "Sending…" : "Send question"}</button>
          </form>
        )}
      </main>

      {gate && (
        <div className="fixed inset-0 bg-black/70 grid place-items-end sm:place-items-center z-40 p-4">
          <div className="w-full max-w-md ko-glass rounded-3xl p-6 bg-[#12100a]">
            <h3 className="font-display text-2xl">Welcome to {shop}</h3>
            <p className="text-white/55 text-sm mt-1">Share your name and mobile so the shop can recognise you and reply.</p>
            <input className="mt-4 w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="mt-2 w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="10-digit mobile number" inputMode="numeric" autoComplete="tel" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} />
            {gateError && <p className="text-xs text-rose-400 mt-2">{gateError}</p>}
            <button onClick={saveGate} className="mt-4 w-full ko-gold-bar rounded-xl py-3 font-semibold">Continue</button>
            <button onClick={() => { setGate(false); setGateError(""); }} className="mt-2 w-full text-sm text-white/45">Skip</button>
          </div>
        </div>
      )}
    </div>
  );
}
