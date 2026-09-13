import { AdminTable } from "@/components/admin/AdminTable";

export default function LogisticsPage() {
  return (
    <AdminTable
      title="Delivery Gateways"
      subtitle="Shiprocket / Porter / Delhivery — Vendor delivery providers"
      endpoint="/v1/admin/table/logistics_gateways"
    />
  );
}
