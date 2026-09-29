import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MessageCircle, Phone, QrCode } from "lucide-react";
import { api, str } from "@/lib/api";

const VISITOR_KEY = "ko-visitor";
const validPhone = (p: string) => /^[6-9]\d{9}$/.test(p.replace(/\D/g, "").slice(-10));

export default function QrLandingPage() {
  const { code = "" } = useParams();
  const [landing, setLanding] = useState<Record<string, unknown> | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visitNo, setVisitNo] = useState<number | null>(null);

  useEffect(() => {
    api<Record<string, unknown>>(`/v1/shops/${encodeURIComponent(code)}/landing?kind=q`)
      .then(setLanding)
      .catch(() => setLanding({ name: code }));
    try {
      const v = JSON.parse(localStorage.getItem(VISITOR_KEY) ?? "null") as { name?: string; phone?: string } | null;
      if (v?.name) setName(v.name);
      if (v?.phone) setPhone(v.phone);
    } catch {
      /* ignore */
    }
  }, [code]);

  const shop = str(landing?.name, code);
  const digits = str(landing?.whatsapp || landing?.phone).replace(/\D/g, "").slice(-10);

  const record = async () => {
    const p = phone.replace(/\D/g, "").slice(-10);
    if (!name.trim()) return setError("Enter your name");
    if (!validPhone(p)) return setError("Enter a valid 10-digit mobile number");
    setError("");
    setBusy(true);
    try {
      const r = await api<{ visit_count?: number }>(`/v1/shops/${encodeURIComponent(code)}/visit`, {
        method: "POST",
        body: JSON.stringify({ kind: "q", source: "stand", visitor_name: name.trim(), visitor_phone: p }),
      });
      localStorage.setItem(VISITOR_KEY, JSON.stringify({ name: name.trim(), phone: p }));
      setVisitNo(Number(r?.visit_count ?? 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const shopLink = landing?.project
    ? `/s/${encodeURIComponent(code)}?p=${encodeURIComponent(str(landing.project))}`
    : `/s/${encodeURIComponent(code)}`;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white grid place-items-center px-4">
      <div className="max-w-md w-full ko-glass rounded-3xl p-8 text-center">
        <QrCode className="h-10 w-10 text-[#f5d97a] mx-auto mb-3" />
        <div className="text-xs uppercase tracking-[0.2em] text-[#f5d97a]">Check in</div>
        <h1 className="font-display text-4xl mt-2">{shop}</h1>
        {str(landing?.trade) && <p className="text-white/55 mt-2">{str(landing?.trade)}</p>}
        {visitNo != null ? (
          <p className="text-[#f5d97a] mt-4">{visitNo > 1 ? `Welcome back! This is visit #${visitNo}.` : "Thanks for checking in!"}</p>
        ) : (
          <div className="grid gap-2 text-left mt-6">
            <input className="rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="10-digit mobile number" inputMode="numeric" autoComplete="tel" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} />
            {error && <p className="text-xs text-rose-400">{error}</p>}
            <button onClick={record} disabled={busy} className="ko-gold-bar rounded-xl py-3 font-semibold disabled:opacity-60">{busy ? "Checking in…" : "Continue"}</button>
          </div>
        )}
        <div className="flex gap-2 mt-6">
          {digits.length === 10 && (
            <a href={`https://wa.me/91${digits}`} className="flex-1 border border-white/15 rounded-xl py-3 inline-flex items-center justify-center gap-2">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          )}
          {digits.length === 10 && (
            <a href={`tel:+91${digits}`} className="flex-1 border border-white/15 rounded-xl py-3 inline-flex items-center justify-center gap-2">
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
        </div>
        <Link to={shopLink} className="block mt-4 text-[#f5d97a] text-sm">Open full shop →</Link>
      </div>
    </div>
  );
}
