import { Link } from "react-router-dom";
import { ArrowRight, QrCode, Store, Wallet } from "lucide-react";
import { FeatureCard, Section, SectionHeader } from "@/components/sections";

export default function ForVendorsPage() {
  return (
    <Section className="!pt-20">
      <SectionHeader eyebrow="For vendors" title={<>Get qualified leads. <span className="ko-gold-text">Pay only when you accept.</span></>} subtitle="No monthly lock-in. Print one QR. Walk-ins become chat and orders." />
      <div className="grid gap-5 md:grid-cols-3 mb-10">
        <FeatureCard icon={<Store className="h-5 w-5" />} title="Quick leads" desc="Customers near you tap Find Vendor. You accept and chat." />
        <FeatureCard icon={<QrCode className="h-5 w-5" />} title="One QR shop" desc="A stranger scans and lands on your public shop — no app required." />
        <FeatureCard icon={<Wallet className="h-5 w-5" />} title="Wallet + KYC" desc="Withdraw after verification. Referral bonus for every shop you onboard." />
      </div>
      <div className="flex flex-wrap gap-3">
        <Link to="/f/join-vendor" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold ko-gold-bar">
          Apply as vendor <ArrowRight className="h-4 w-4" />
        </Link>
        <Link to="/pricing" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold border border-white/15">See pricing</Link>
      </div>
    </Section>
  );
}
