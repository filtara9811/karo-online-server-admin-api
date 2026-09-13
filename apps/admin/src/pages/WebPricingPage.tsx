import { AdminTable } from "@/components/admin/AdminTable";

export default function WebPricingPage() {
  return (
    <AdminTable
      title="Pricing Plans"
      subtitle="Public website pricing cards"
      endpoint="/v1/admin/table/web_pricing_plans"
    />
  );
}
