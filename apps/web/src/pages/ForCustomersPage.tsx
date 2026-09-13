import { Link } from "react-router-dom";
import { ArrowRight, MapPin, MessageCircle, Shield } from "lucide-react";
import { FeatureCard, Section, SectionHeader } from "@/components/sections";

export default function ForCustomersPage() {
  return (
    <Section className="!pt-20">
      <SectionHeader eyebrow="For customers" title={<>Need something done <span className="ko-gold-text">near you?</span></>} subtitle="Request a plumber, electrician or beauty visit. Nearby vendors reply. You pick." />
      <div className="grid gap-5 md:grid-cols-3 mb-10">
        <FeatureCard icon={<MapPin className="h-5 w-5" />} title="See who is online" desc="A live map of verified vendors in your radius." />
        <FeatureCard icon={<MessageCircle className="h-5 w-5" />} title="Chat before you book" desc="Ask price, time and photos in the same thread." />
        <FeatureCard icon={<Shield className="h-5 w-5" />} title="Pay when done" desc="Escrow and refunds. No cash surprises." />
      </div>
      <Link to="/download" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold ko-gold-bar">
        Get the customer app <ArrowRight className="h-4 w-4" />
      </Link>
    </Section>
  );
}
