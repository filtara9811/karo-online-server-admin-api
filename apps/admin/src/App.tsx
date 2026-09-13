import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "@/components/admin/AdminLayout";
import LoginPage from "@/pages/LoginPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import DashboardPage from "@/pages/DashboardPage";
import LeadsPage from "@/pages/LeadsPage";
import OneQrPage from "@/pages/OneQrPage";
import QrAssetsPage from "@/pages/QrAssetsPage";
import LookupPage from "@/pages/LookupPage";
import UserDetailPage from "@/pages/UserDetailPage";
import CustomersPage from "@/pages/CustomersPage";
import VendorsPage from "@/pages/VendorsPage";
import CatalogPage from "@/pages/CatalogPage";
import StaffPage from "@/pages/StaffPage";
import StaffOpsPage from "@/pages/StaffOpsPage";
import PaymentsPage from "@/pages/PaymentsPage";
import CashfreePage from "@/pages/CashfreePage";
import KycPage from "@/pages/KycPage";
import KycReviewPage from "@/pages/KycReviewPage";
import SmsPage from "@/pages/SmsPage";
import WhatsappPage from "@/pages/WhatsappPage";
import CommunicationPage from "@/pages/CommunicationPage";
import FirebasePage from "@/pages/FirebasePage";
import NotificationsPage from "@/pages/NotificationsPage";
import MapsPage from "@/pages/MapsPage";
import ApiKeysPage from "@/pages/ApiKeysPage";
import SystemStatusPage from "@/pages/SystemStatusPage";
import DevicesPage from "@/pages/DevicesPage";
import TestAccountsPage from "@/pages/TestAccountsPage";
import LogisticsPage from "@/pages/LogisticsPage";
import CoinsPage from "@/pages/CoinsPage";
import ReferralsPage from "@/pages/ReferralsPage";
import FormsPage from "@/pages/FormsPage";
import BrandingPage from "@/pages/BrandingPage";
import LegalPage from "@/pages/LegalPage";
import WebHubPage from "@/pages/WebHubPage";
import WebSeoPage from "@/pages/WebSeoPage";
import WebHeroPage from "@/pages/WebHeroPage";
import WebSectionsPage from "@/pages/WebSectionsPage";
import WebPricingPage from "@/pages/WebPricingPage";
import WebApkPage from "@/pages/WebApkPage";
import WebOffersPage from "@/pages/WebOffersPage";
import WebTestimonialsPage from "@/pages/WebTestimonialsPage";
import WebFaqsPage from "@/pages/WebFaqsPage";
import WebFormsPage from "@/pages/WebFormsPage";
import WebBlogPage from "@/pages/WebBlogPage";
import WebMediaPage from "@/pages/WebMediaPage";
import WebDevicesPage from "@/pages/WebDevicesPage";
import HomeContentPage from "@/pages/HomeContentPage";
import OnboardingPage from "@/pages/OnboardingPage";
import VideoPage from "@/pages/VideoPage";
import SettingsPage from "@/pages/SettingsPage";
import FeedbackPage from "@/pages/FeedbackPage";
import ProfilePage from "@/pages/ProfilePage";
import SubscriptionPage from "@/pages/SubscriptionPage";
import ScanInsightsPage from "@/pages/ScanInsightsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<AdminLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/one-qr" element={<OneQrPage />} />
        <Route path="/qr-assets" element={<QrAssetsPage />} />
        <Route path="/subscription" element={<SubscriptionPage />} />
        <Route path="/scan-insights" element={<ScanInsightsPage />} />
        <Route path="/lookup" element={<LookupPage />} />
        <Route path="/users/:userId" element={<UserDetailPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/vendors" element={<VendorsPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/staff-ops" element={<StaffOpsPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/cashfree" element={<CashfreePage />} />
        <Route path="/kyc" element={<KycPage />} />
        <Route path="/kyc-review" element={<KycReviewPage />} />
        <Route path="/sms" element={<SmsPage />} />
        <Route path="/whatsapp" element={<WhatsappPage />} />
        <Route path="/communication" element={<CommunicationPage />} />
        <Route path="/firebase" element={<FirebasePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/maps" element={<MapsPage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="/system-status" element={<SystemStatusPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/test-accounts" element={<TestAccountsPage />} />
        <Route path="/logistics" element={<LogisticsPage />} />
        <Route path="/coins" element={<CoinsPage />} />
        <Route path="/referrals" element={<ReferralsPage />} />
        <Route path="/forms" element={<FormsPage />} />
        <Route path="/branding" element={<BrandingPage />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/web" element={<WebHubPage />} />
        <Route path="/web/seo" element={<WebSeoPage />} />
        <Route path="/web/hero" element={<WebHeroPage />} />
        <Route path="/web/sections" element={<WebSectionsPage />} />
        <Route path="/web/pricing" element={<WebPricingPage />} />
        <Route path="/web/apk" element={<WebApkPage />} />
        <Route path="/web/offers" element={<WebOffersPage />} />
        <Route path="/web/testimonials" element={<WebTestimonialsPage />} />
        <Route path="/web/faqs" element={<WebFaqsPage />} />
        <Route path="/web/forms" element={<WebFormsPage />} />
        <Route path="/web/blog" element={<WebBlogPage />} />
        <Route path="/web/media" element={<WebMediaPage />} />
        <Route path="/web/devices" element={<WebDevicesPage />} />
        <Route path="/home-content" element={<HomeContentPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/video" element={<VideoPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
