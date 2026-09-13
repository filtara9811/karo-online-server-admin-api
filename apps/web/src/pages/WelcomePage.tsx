import { Link } from "react-router-dom";
import { ArrowRight, Bell, CheckCircle2, Download, MapPin, Shield, Smartphone, Users, Wallet, Zap } from "lucide-react";
import { FeatureCard, Section, SectionHeader } from "@/components/sections";

export default function WelcomePage() {
  return (
    <>
      <section className="relative ko-aurora overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 md:pt-28 pb-20 md:pb-32 relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#d4af37]/30 bg-[#d4af37]/5 text-[#f5d97a] text-xs uppercase tracking-[0.22em] mb-6">
            India's Premium Hyperlocal Marketplace
          </div>
          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl leading-[1.05] max-w-4xl">
            Local vendors. <br />
            <span className="ko-gold-text">Premium service.</span> <span className="text-white">Delivered fast.</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-white/65 max-w-2xl leading-relaxed">
            Find trusted vendors near you — repairs, beauty, cleaning, products and more. Real-time tracking, secure payments, transparent pricing.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/download" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-semibold ko-gold-bar">
              Open the app <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/for-vendors" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl font-semibold border border-white/15 text-white hover:border-[#d4af37]/50">
              Become a vendor
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-white/50">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#d4af37]" /> 10,000+ verified vendors</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#d4af37]" /> Secure payments</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#d4af37]" /> 4.9★ rated</div>
          </div>
        </div>
      </section>

      <Section>
        <SectionHeader
          eyebrow="Why KaroOnline"
          title={<>Built for India. <span className="ko-gold-text">Crafted for trust.</span></>}
          subtitle="Everything you need to discover, book and pay local vendors — in one premium experience."
        />
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={<Zap className="h-5 w-5" />} title="Instant Quick Service" desc="Tap once. Nearby vendors bid in real-time. Pick the best, book in seconds." />
          <FeatureCard icon={<Shield className="h-5 w-5" />} title="Secure Payments" desc="Escrow-backed payments. Pay when work is done. Full refund protection." />
          <FeatureCard icon={<MapPin className="h-5 w-5" />} title="Live Tracking" desc="Real-time vendor location, ETA and order status — from booking to completion." />
          <FeatureCard icon={<Users className="h-5 w-5" />} title="Verified Vendors" desc="KYC-verified, rated and reviewed by your neighbours. No surprises." />
          <FeatureCard icon={<Wallet className="h-5 w-5" />} title="Transparent Pricing" desc="See item-by-item quotes before you commit. No hidden fees." />
          <FeatureCard icon={<Bell className="h-5 w-5" />} title="Smart Notifications" desc="Bid updates, chat messages and order alerts instantly via push." />
        </div>
      </Section>

      <Section>
        <div className="grid gap-5 md:grid-cols-2">
          <Link to="/for-customers" className="ko-glass rounded-3xl p-8 md:p-10 group hover:border-[#d4af37]/50">
            <div className="text-xs uppercase tracking-[0.22em] text-[#f5d97a] mb-3">For Customers</div>
            <h3 className="font-display text-3xl md:text-4xl text-white mb-3">Need a service?</h3>
            <p className="text-white/60 mb-6">Find a verified vendor near you in seconds.</p>
            <div className="inline-flex items-center gap-2 text-white group-hover:text-[#f5d97a]">Learn more <ArrowRight className="h-4 w-4" /></div>
          </Link>
          <Link to="/for-vendors" className="ko-glass rounded-3xl p-8 md:p-10 group hover:border-[#d4af37]/50">
            <div className="text-xs uppercase tracking-[0.22em] text-[#f5d97a] mb-3">For Vendors</div>
            <h3 className="font-display text-3xl md:text-4xl text-white mb-3">Grow your business.</h3>
            <p className="text-white/60 mb-6">Get qualified leads from your area. Zero monthly fees to start.</p>
            <div className="inline-flex items-center gap-2 text-white group-hover:text-[#f5d97a]">Become a vendor <ArrowRight className="h-4 w-4" /></div>
          </Link>
        </div>
      </Section>

      <Section className="!py-12">
        <div className="ko-glass rounded-3xl p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <Smartphone className="h-10 w-10 text-[#f5d97a]" />
            <div>
              <h3 className="font-display text-2xl md:text-3xl text-white">Get the mobile app</h3>
              <p className="text-white/55 text-sm mt-1">Faster, with push notifications and offline support.</p>
            </div>
          </div>
          <Link to="/download" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold ko-gold-bar">
            <Download className="h-4 w-4" /> Download
          </Link>
        </div>
      </Section>
    </>
  );
}
