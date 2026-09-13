import { Link } from "react-router-dom";
import {
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  BadgePercent,
  Star,
  MessageSquare,
  HelpCircle,
  Smartphone,
  ClipboardList,
  BookOpen,
  FileText,
  ArrowRight,
} from "lucide-react";
import { GoldCard, PageHeader } from "@/components/admin/AdminLayout";

const TILES = [
  { to: "/web/seo", label: "SEO per Page", icon: Globe, desc: "Title, meta, keywords, OG image" },
  { to: "/web/hero", label: "Hero Banners", icon: ImageIcon, desc: "Per-page hero with CTA" },
  { to: "/web/sections", label: "Content Blocks", icon: LayoutGrid, desc: "Features, text, image blocks" },
  { to: "/web/pricing", label: "Pricing Plans", icon: FileText, desc: "Manage plan cards" },
  { to: "/web/apk", label: "APK / Downloads", icon: Smartphone, desc: "Upload APK or paste Play Store link" },
  { to: "/web/offers", label: "Offer Bar", icon: BadgePercent, desc: "Sitewide top banner" },
  { to: "/web/testimonials", label: "Testimonials", icon: Star, desc: "Reviews & ratings" },
  { to: "/web/faqs", label: "FAQs", icon: HelpCircle, desc: "Per-page FAQs" },
  { to: "/web/forms", label: "Custom Forms", icon: ClipboardList, desc: "Lead capture & submissions" },
  { to: "/web/blog", label: "Blog", icon: BookOpen, desc: "SEO articles, rich content" },
  { to: "/web/media", label: "Media Library", icon: MessageSquare, desc: "Browse uploaded assets" },
  { to: "/web/devices", label: "Virtual Devices", icon: Smartphone, desc: "Floating phone mockups shown on site" },
];

export default function WebHubPage() {
  return (
    <div>
      <PageHeader
        title="Special Web · Marketing Site"
        subtitle="A-to-Z control of your public website — instant live publish"
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TILES.map((t) => (
          <Link key={t.to} to={t.to}>
            <GoldCard className="p-5 hover:border-[#d4af37]/60 transition group cursor-pointer">
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="h-10 w-10 rounded-xl grid place-items-center text-[#1a1208]"
                  style={{ background: "linear-gradient(180deg,#fff3c8,#d4af37 60%,#8b6508)" }}
                >
                  <t.icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-lg text-[#fff8dc]">{t.label}</h3>
                <ArrowRight className="ml-auto h-4 w-4 text-[#d4af37]/60 group-hover:text-[#fff8dc] group-hover:translate-x-1 transition" />
              </div>
              <p className="text-xs text-[#f5d97a]/60">{t.desc}</p>
            </GoldCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
