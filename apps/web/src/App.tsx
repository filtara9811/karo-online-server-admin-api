import { Navigate, Route, Routes } from "react-router-dom";
import { MarketingLayout } from "@/components/MarketingLayout";
import WelcomePage from "@/pages/WelcomePage";
import AboutPage from "@/pages/AboutPage";
import FeaturesPage from "@/pages/FeaturesPage";
import PricingPage from "@/pages/PricingPage";
import ContactPage from "@/pages/ContactPage";
import ForCustomersPage from "@/pages/ForCustomersPage";
import ForVendorsPage from "@/pages/ForVendorsPage";
import DownloadPage from "@/pages/DownloadPage";
import BlogIndexPage from "@/pages/BlogIndexPage";
import BlogPostPage from "@/pages/BlogPostPage";
import LegalPage from "@/pages/LegalPage";
import ShopLandingPage from "@/pages/ShopLandingPage";
import QrLandingPage from "@/pages/QrLandingPage";
import CardLandingPage from "@/pages/CardLandingPage";
import ReferralLandingPage from "@/pages/ReferralLandingPage";
import FormLandingPage from "@/pages/FormLandingPage";
import HomeCatalogPage from "@/pages/HomeCatalogPage";

export default function App() {
  return (
    <Routes>
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/for-customers" element={<ForCustomersPage />} />
        <Route path="/for-vendors" element={<ForVendorsPage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/blog" element={<BlogIndexPage />} />
        <Route path="/blog/:slug" element={<BlogPostPage />} />
        <Route path="/privacy-policy" element={<LegalPage slug="privacy" />} />
        <Route path="/terms-and-conditions" element={<LegalPage slug="terms" />} />
        <Route path="/shipping-policy" element={<LegalPage slug="shipping" />} />
        <Route path="/refund-policy" element={<LegalPage slug="refund" />} />
      </Route>
      <Route path="/home" element={<HomeCatalogPage />} />
      <Route path="/s/:code" element={<ShopLandingPage />} />
      <Route path="/q/:code" element={<QrLandingPage />} />
      <Route path="/c/:code" element={<CardLandingPage />} />
      <Route path="/r/:code" element={<ReferralLandingPage />} />
      <Route path="/f/:slug" element={<FormLandingPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
