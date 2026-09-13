import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pages = [
  ["QrAssetsPage", "QR Assets & Printing", "Design, print and assign branded QR batches", "/v1/admin/table/qr_batches"],
  ["StaffOpsPage", "Staff Operations", "Approve signups, invite via deep link, create staff, assign tasks, process payouts", "/v1/admin/table/staff_tasks"],
  ["CashfreePage", "Cashfree Services", "Multiple Cashfree products configure karein aur har service ko app ke specific use-case se assign karein", "/v1/admin/table/cashfree_services"],
  ["KycReviewPage", "KYC Submissions", "Customer / Vendor ke documents review karein — approve ya reject", "/v1/admin/table/kyc_submissions"],
  ["SmsPage", "SMS Gateways", "OTP bhejne ke liye provider — sirf ek active rahega", "/v1/admin/table/sms_gateways"],
  ["WhatsappPage", "WhatsApp API", "Fast2SMS Meta WhatsApp + Meta Cloud fallback — templates, live/test mode, failover priority", "/v1/admin/table/whatsapp_config"],
  ["CommunicationPage", "Communication Hub", "AI Voice Agent (DialNexa) + per-group WhatsApp/Voice toggles + Voice call log", "/v1/admin/table/communication_settings"],
  ["FirebasePage", "Firebase Services", "Authentication, Cloud Messaging, Analytics, Crashlytics, Dynamic Links & Remote Config — sab ek jagah configure karein", "/v1/admin/table/firebase_services"],
  ["NotificationsPage", "Notification Engine", "Campaigns, segmentation, push triggers, delivery logs & analytics", "/v1/admin/table/notification_campaigns"],
  ["MapsPage", "Maps Providers", "Google Maps & Mappls (MapmyIndia) — geocoding, nearby vendors, directions, hyperlocal discovery", "/v1/admin/table/maps_providers"],
  ["ApiKeysPage", "API Management", "RapidAPI keys for Instagram & Pinterest auto-feed", "/v1/admin/table/api_keys"],
  ["SystemStatusPage", "System Status", "Live health of SMS & Payment gateways", "/v1/admin/table/system_status"],
  ["DevicesPage", "🔓 Device Unlock", "Customer/vendor device-lock bindings. Staff onboarding devices are auto-bypassed.", "/v1/admin/table/device_locks"],
  ["TestAccountsPage", "Test Accounts (Reviewer Mode)", "Apni marzi se reviewer / Play Store / payment-gateway tester accounts manage karein", "/v1/admin/table/test_accounts"],
  ["LogisticsPage", "Delivery Gateways", "Shiprocket / Porter / Delhivery — Vendor delivery providers", "/v1/admin/table/logistics_gateways"],
  ["CoinsPage", "LeadX Market", "Live supply, circulation & vendor holdings", "/v1/admin/table/coin_pricing_config"],
  ["ReferralsPage", "Referral Program", "Banners, campaigns, rewards approval & analytics — full control", "/v1/admin/table/referral_campaigns"],
  ["FormsPage", "Form Builder", "Customer / Vendor / Staff registration forms — apni marzi se fields add karo", "/v1/admin/table/form_definitions"],
  ["BrandingPage", "Branding Studio", "Colors, fonts, icons, logos — pure app ka look apne haath me", "/v1/admin/table/branding"],
  ["LegalPage", "Legal Pages", "Privacy, Terms, Refund & custom pages — content yahan se update hoga", "/v1/admin/table/legal_pages"],
  ["WebSeoPage", "SEO · Per Page", "Title, meta, keywords, OG image. Keep keywords lowercase & specific (e.g. 'vendor leads India').", "/v1/admin/table/web_pages"],
  ["WebHeroPage", "Hero Banners", "One hero per page slug — first match wins.", "/v1/admin/table/web_hero_sections"],
  ["WebSectionsPage", "Content Blocks", "Reusable blocks per page. Order by 'sort_order'.", "/v1/admin/table/web_content_blocks"],
  ["WebPricingPage", "Pricing Plans", "Public website pricing cards", "/v1/admin/table/web_pricing_plans"],
  ["WebApkPage", "APK / Download Manager", "Upload APK file directly (up to 200 MB) or paste Play Store / Drive link. Mark one row per audience as 'Current'.", "/v1/admin/table/web_apk_releases"],
  ["WebOffersPage", "Offer Bar", "Top announcement strip. Latest active row wins.", "/v1/admin/table/web_offers"],
  ["WebTestimonialsPage", "Testimonials & Brand Logos", "Reviews & ratings", "/v1/admin/table/web_testimonials"],
  ["WebFaqsPage", "FAQs", "Per-page Q&A. Shown in marketing pages.", "/v1/admin/table/web_faqs"],
  ["WebFormsPage", "Custom Forms · Lead Capture", "Each form gets a public URL: /f/<slug>. Submissions viewable in Lookup → Forms (existing module).", "/v1/admin/table/web_forms"],
  ["WebBlogPage", "Blog · SEO Articles", "Markdown supported. Each post auto-generates JSON-LD BlogPosting schema.", "/v1/admin/table/web_blog_posts"],
  ["WebMediaPage", "Media Library", "Reusable images, with alt text for SEO.", "/v1/admin/table/web_media"],
  ["WebDevicesPage", "Virtual Devices", "Add extra floating phone mockups. Each enabled device shows as a button in the website's '+' launcher.", "/v1/admin/table/web_devices"],
  ["HomeContentPage", "Home Content", "Banners (auto-slide) and Recommended Videos shown on the customer home screen.", "/v1/admin/table/home_banners"],
  ["OnboardingPage", "Customer Onboarding Screens", "Splash / intro slides shown before the customer logs in. Drag-style ordering, image / video / Lottie animation supported.", "/v1/admin/table/onboarding_screens"],
  ["VideoPage", "🎬 Onboarding Video Control", "Manage the background video shown on the vendor onboarding / join screen. Paste a YouTube link, a direct MP4/WEBM URL, or upload a file.", "/v1/admin/table/onboarding_video"],
];

mkdirSync(join(root, "src/pages"), { recursive: true });

for (const [name, title, subtitle, endpoint] of pages) {
  const src = `import { AdminTable } from "@/components/admin/AdminTable";

export default function ${name}() {
  return (
    <AdminTable
      title=${JSON.stringify(title)}
      subtitle=${JSON.stringify(subtitle)}
      endpoint=${JSON.stringify(endpoint)}
    />
  );
}
`;
  writeFileSync(join(root, "src/pages", `${name}.tsx`), src);
}

console.log(`wrote ${pages.length} table pages`);
