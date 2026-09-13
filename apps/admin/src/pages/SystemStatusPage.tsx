import { AdminTable } from "@/components/admin/AdminTable";

export default function SystemStatusPage() {
  return (
    <AdminTable
      title="System Status"
      subtitle="Live health of SMS & Payment gateways"
      endpoint="/v1/admin/table/app_settings"
    />
  );
}
