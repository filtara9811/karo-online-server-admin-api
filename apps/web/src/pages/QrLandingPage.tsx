import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MessageCircle, Phone, QrCode } from "lucide-react";
import { api, str } from "@/lib/api";

export default function QrLandingPage() {
  const { code = "" } = useParams();
  const [landing, setLanding] = useState<Record<string, unknown> | null>(null);
  const [otp, setOtp] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [known, setKnown] = useState(false);

  useEffect(() => {
    api<Record<string, unknown>>(`/v1/shops/${encodeURIComponent(code)}/landing?kind=q`)
      .then(setLanding)
      .catch(() => setLanding({ name: code, linked: true }));
  }, [code]);

  const shop = str(landing?.name, code);
  const wa = str(landing?.whatsapp || landing?.phone).replace(/\D/g, "");

  const record = async () => {
    await api(`/v1/shops/${encodeURIComponent(code)}/visit`, {
      method: "POST",
      body: JSON.stringify({ kind: "q", source: "stand", visitor_name: name, visitor_phone: phone }),
    }).catch(() => undefined);
    try {
      document.cookie = `ko_cust_mobile=${encodeURIComponent(phone)}; path=/; max-age=${60 * 60 * 24 * 30}`;
    } catch {
      /* ignore */
    }
    setKnown(true);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white grid place-items-center px-4">
      <div className="max-w-md w-full ko-glass rounded-3xl p-8 text-center">
        <QrCode className="h-10 w-10 text-[#f5d97a] mx-auto mb-3" />
        <div className="text-xs uppercase tracking-[0.2em] text-[#f5d97a]">Stand QR</div>
        <h1 className="font-display text-4xl mt-2">{shop}</h1>
        <p className="text-white/55 mt-2">{str(landing?.trade, "Verified shop")}</p>
        {known ? (
          <p className="text-[#f5d97a] mt-4">Welcome back. Visit #{Number(landing?.visit_count ?? 1) + 1}</p>
        ) : (
          <div className="grid gap-2 text-left mt-6">
            <input className="rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="10-digit phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className="rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="OTP (dev 1234)" value={otp} onChange={(e) => setOtp(e.target.value)} />
            <button onClick={record} className="ko-gold-bar rounded-xl py-3 font-semibold">Continue</button>
          </div>
        )}
        <div className="flex gap-2 mt-6">
          {wa && (
            <a href={`https://wa.me/${wa}`} className="flex-1 border border-white/15 rounded-xl py-3 inline-flex items-center justify-center gap-2">
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
          )}
          {str(landing?.phone) && (
            <a href={`tel:+91${str(landing?.phone)}`} className="flex-1 border border-white/15 rounded-xl py-3 inline-flex items-center justify-center gap-2">
              <Phone className="h-4 w-4" /> Call
            </a>
          )}
        </div>
        <Link to={`/s/${encodeURIComponent(code)}`} className="block mt-4 text-[#f5d97a] text-sm">Open full shop →</Link>
      </div>
    </div>
  );
}
