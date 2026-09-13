import { AdminTable } from "@/components/admin/AdminTable";

export default function CoinsPage() {
  return (
    <AdminTable
      title="LeadX Market"
      subtitle="Live supply, circulation & vendor holdings"
      endpoint="/v1/admin/table/coin_pricing_config"
    />
  );
}
