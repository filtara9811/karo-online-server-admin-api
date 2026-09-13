import { AdminTable } from "@/components/admin/AdminTable";

export default function DevicesPage() {
  return (
    <AdminTable
      title="🔓 Device Unlock"
      subtitle="Customer/vendor device-lock bindings. Staff onboarding devices are auto-bypassed."
      endpoint="/v1/admin/table/device_fingerprints"
    />
  );
}
