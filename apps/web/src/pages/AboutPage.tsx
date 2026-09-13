import { Building2, Globe, Heart, Mail, MapPin, Sparkles, Target } from "lucide-react";
import { FeatureCard, Section, SectionHeader } from "@/components/sections";

export default function AboutPage() {
  return (
    <>
      <Section className="!pt-20">
        <SectionHeader
          eyebrow="Our Story"
          title={<>We're building India's <span className="ko-gold-text">most trusted</span> local marketplace.</>}
          subtitle="KaroOnline started with one idea — close the trust gap between local vendors and customers."
        />
      </Section>
      <Section className="!pt-0">
        <div className="grid gap-5 md:grid-cols-3">
          <FeatureCard icon={<Target className="h-5 w-5" />} title="Our Mission" desc="Every Indian neighbourhood deserves verified, fairly-priced, premium local services." />
          <FeatureCard icon={<Heart className="h-5 w-5" />} title="Our Values" desc="Trust, transparency, and respect for both customers and the vendors who serve them." />
          <FeatureCard icon={<Sparkles className="h-5 w-5" />} title="Our Promise" desc="Premium experience at hyperlocal scale — from booking to delivery." />
        </div>
      </Section>
      <Section>
        <div className="ko-glass rounded-3xl p-8 md:p-12">
          <div className="text-xs uppercase tracking-[0.22em] text-[#f5d97a] mb-3">Company Information</div>
          <h3 className="font-display text-3xl text-white mb-6">Filipra Private Limited</h3>
          <div className="grid gap-4 sm:grid-cols-2 text-white/80">
            <Info icon={<Building2 className="h-5 w-5" />} label="Service" value="Hyperlocal Lead Generation Marketplace" />
            <Info icon={<Globe className="h-5 w-5" />} label="Website" value="karoonline.in" />
            <Info icon={<Mail className="h-5 w-5" />} label="Email" value="Ashu@filipra.com" />
            <Info icon={<MapPin className="h-5 w-5" />} label="Address" value="4988, First Floor, Gali Maliyan Chowk, Ahata Kidara, Sadar Bazar, Delhi" />
          </div>
        </div>
      </Section>
    </>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="text-[#d4af37] mt-0.5">{icon}</div>
      <div>
        <div className="text-xs uppercase tracking-wider text-white/50">{label}</div>
        <div>{value}</div>
      </div>
    </div>
  );
}
