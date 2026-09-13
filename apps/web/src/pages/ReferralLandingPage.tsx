import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Gift } from "lucide-react";
import { api } from "@/lib/api";

const PLAY = "https://play.google.com/store/apps/details?id=app.karoonline.twa";

export default function ReferralLandingPage() {
  const { code = "" } = useParams();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("ko-pending-referral", code);
      document.cookie = `ko_ref=${encodeURIComponent(code)}; path=/; max-age=${60 * 60 * 24 * 30}`;
    } catch {
      /* ignore */
    }
    api(`/v1/shops/${encodeURIComponent(code)}/visit`, {
      method: "POST",
      body: JSON.stringify({ kind: "r", source: "link" }),
    }).catch(() => undefined);
  }, [code]);

  const claim = async () => {
    await api(`/v1/shops/${encodeURIComponent(code)}/visit`, {
      method: "POST",
      body: JSON.stringify({ kind: "r", source: "link", visitor_name: name, visitor_phone: phone }),
    }).catch(() => undefined);
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white grid place-items-center px-4">
      <div className="max-w-md w-full ko-glass rounded-3xl p-8 text-center">
        <Gift className="h-10 w-10 text-[#f5d97a] mx-auto mb-3" />
        <h1 className="font-display text-3xl">Get ₹200 for you & ₹100 for your friend</h1>
        <p className="text-white/55 mt-2">Use code <span className="text-[#f5d97a] font-bold">{code}</span> on Karo Online.</p>
        {done ? (
          <div className="mt-6 grid gap-2">
            <a href={`${PLAY}&referrer=${encodeURIComponent(`utm_source=referral&ref=${code}`)}`} className="ko-gold-bar rounded-xl py-3 font-semibold">Download the app</a>
            <Link to="/download" className="text-sm text-white/50">Or continue on web</Link>
          </div>
        ) : (
          <div className="grid gap-2 mt-6 text-left">
            <input className="rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="rounded-xl bg-black/30 border border-white/10 px-3 py-2" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button onClick={claim} className="ko-gold-bar rounded-xl py-3 font-semibold">Join with this code</button>
          </div>
        )}
      </div>
    </div>
  );
}
