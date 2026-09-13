import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { api, asList } from "@/lib/api";
import { Section, SectionHeader } from "@/components/sections";

const FALLBACK = [
  { name: "Customer", price: "Free", sub: "Forever, for everyone.", features: ["Unlimited service requests", "Real-time vendor bids", "Secure payments", "Live tracking"], href: "/download", accent: false, cta: "Get the app" },
  { name: "Vendor — Starter", price: "₹0", sub: "Setup fee. Pay-per-lead.", features: ["Free onboarding", "Pay only for accepted leads", "Shop + catalog", "In-app chat"], href: "/for-vendors", accent: true, cta: "Become a vendor" },
  { name: "Vendor — Pro", price: "Custom", sub: "For high-volume businesses.", features: ["Priority leads", "Featured shop", "Multi-staff", "Dedicated manager"], href: "/contact", accent: false, cta: "Contact sales" },
];

export default function PricingPage() {
  const [plans, setPlans] = useState(FALLBACK);
  useEffect(() => {
    api<Record<string, unknown>>("/v1/cms/site")
      .then((site) => {
        const rows = asList(site.pricing);
        if (!rows.length) return;
        setPlans(
          rows.map((p, i) => ({
            name: String(p.name ?? FALLBACK[i]?.name ?? "Plan"),
            price: String(p.price ?? "—"),
            sub: String(p.sub ?? ""),
            features: Array.isArray(p.features) ? p.features.map(String) : FALLBACK[i]?.features ?? [],
            href: i === 0 ? "/download" : i === 1 ? "/for-vendors" : "/contact",
            accent: Boolean(p.accent),
            cta: i === 0 ? "Get the app" : i === 1 ? "Become a vendor" : "Contact sales",
          })),
        );
      })
      .catch(() => undefined);
  }, []);

  return (
    <Section className="!pt-20">
      <SectionHeader eyebrow="Pricing" title={<>Simple, <span className="ko-gold-text">honest pricing.</span></>} subtitle="Free for customers. Vendors pay only when they win business." />
      <div className="grid gap-5 md:grid-cols-3">
        {plans.map((p) => (
          <div key={p.name} className={`ko-glass rounded-3xl p-7 ${p.accent ? "border-[#d4af37]/50" : ""}`}>
            <div className="text-xs uppercase tracking-[0.2em] text-[#f5d97a]">{p.name}</div>
            <div className="font-display text-4xl text-white mt-2">{p.price}</div>
            <p className="text-white/55 text-sm mt-1">{p.sub}</p>
            <ul className="mt-6 space-y-2 text-sm text-white/75">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2"><Check className="h-4 w-4 text-[#d4af37] shrink-0" />{f}</li>
              ))}
            </ul>
            <Link to={p.href} className={`mt-8 inline-flex w-full justify-center px-4 py-3 rounded-xl font-semibold ${p.accent ? "ko-gold-bar" : "border border-white/15"}`}>
              {p.cta}
            </Link>
          </div>
        ))}
      </div>
    </Section>
  );
}
