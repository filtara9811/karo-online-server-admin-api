import { Bell, MapPin, QrCode, Shield, ShoppingBag, Users, Wallet, Zap } from "lucide-react";
import { FeatureCard, Section, SectionHeader } from "@/components/sections";

export default function FeaturesPage() {
  return (
    <Section className="!pt-20">
      <SectionHeader eyebrow="Features" title={<>Everything in <span className="ko-gold-text">one maison.</span></>} subtitle="Quick service, digital shops, One QR, referrals and live chat." />
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <FeatureCard icon={<Zap className="h-5 w-5" />} title="Quick Service" desc="Nearby vendors bid on your request. Pick, chat, track." />
        <FeatureCard icon={<QrCode className="h-5 w-5" />} title="One QR" desc="One printed code opens your shop, videos and chat on the web." />
        <FeatureCard icon={<ShoppingBag className="h-5 w-5" />} title="Digital Shop" desc="Products, orders and UPI — no extra app for the customer." />
        <FeatureCard icon={<Users className="h-5 w-5" />} title="Refer & earn" desc="Share /r/CODE. Both sides get wallet credit after KYC." />
        <FeatureCard icon={<Shield className="h-5 w-5" />} title="KYC vendors" desc="Identity-checked professionals with ratings." />
        <FeatureCard icon={<Wallet className="h-5 w-5" />} title="Wallet" desc="Lead coins, refunds and referral bonuses in one place." />
        <FeatureCard icon={<MapPin className="h-5 w-5" />} title="Live map" desc="See who is online around you before you book." />
        <FeatureCard icon={<Bell className="h-5 w-5" />} title="Push + WhatsApp" desc="Vendors get the lead on phone, WhatsApp and in-app." />
      </div>
    </Section>
  );
}
