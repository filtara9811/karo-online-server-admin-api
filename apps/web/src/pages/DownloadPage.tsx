import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { Section, SectionHeader } from "@/components/sections";

const PLAY = "https://play.google.com/store/apps/details?id=app.karoonline.twa";

export default function DownloadPage() {
  const [url, setUrl] = useState(PLAY);
  useEffect(() => {
    api<{ apk?: { play_store_url?: string } }>("/v1/cms/site")
      .then((s) => {
        if (s.apk?.play_store_url) setUrl(s.apk.play_store_url);
      })
      .catch(() => undefined);
  }, []);

  return (
    <Section className="!pt-20">
      <SectionHeader eyebrow="Download" title={<>Get <span className="ko-gold-text">Karo Online</span> on your phone.</>} subtitle="Same gold Quick home you see in the store listing." />
      <div className="max-w-lg mx-auto ko-glass rounded-3xl p-8 text-center">
        <Smartphone className="h-12 w-12 text-[#f5d97a] mx-auto mb-4" />
        <a href={url} className="inline-flex px-6 py-3 rounded-xl font-semibold ko-gold-bar">Open Play Store</a>
        <p className="text-white/50 text-sm mt-4">iOS listing is in review. Scan any shop QR to use the web shop today.</p>
      </div>
    </Section>
  );
}
