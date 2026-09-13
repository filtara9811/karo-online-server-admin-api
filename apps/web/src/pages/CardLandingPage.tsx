import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";

const PLAY = "https://play.google.com/store/apps/details?id=app.karoonline.twa";

export default function CardLandingPage() {
  const { code = "" } = useParams();

  useEffect(() => {
    api(`/v1/shops/${encodeURIComponent(code)}/visit`, {
      method: "POST",
      body: JSON.stringify({ kind: "c", source: "card" }),
    }).catch(() => undefined);
    const ua = navigator.userAgent || "";
    const target = /Android/i.test(ua)
      ? `${PLAY}&referrer=${encodeURIComponent(`utm_source=business_card&code=${code}`)}`
      : /iPhone|iPad|iPod/i.test(ua)
        ? "https://apps.apple.com/app/karo-online/id0000000000"
        : `/s/${encodeURIComponent(code)}`;
    window.location.replace(target);
  }, [code]);

  return (
    <div className="min-h-screen grid place-items-center bg-[#0a0a0a] text-white">
      <p className="text-white/60">Opening this business card…</p>
    </div>
  );
}
