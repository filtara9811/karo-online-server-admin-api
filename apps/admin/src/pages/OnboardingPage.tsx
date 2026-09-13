import { AdminTable } from "@/components/admin/AdminTable";

export default function OnboardingPage() {
  return (
    <AdminTable
      title="Customer Onboarding Screens"
      subtitle="Splash / intro slides shown before the customer logs in. Drag-style ordering, image / video / Lottie animation supported."
      endpoint="/v1/admin/table/onboarding_slides"
    />
  );
}
