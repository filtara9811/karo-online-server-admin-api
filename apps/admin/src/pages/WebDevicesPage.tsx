import { AdminTable } from "@/components/admin/AdminTable";

export default function WebDevicesPage() {
  return (
    <AdminTable
      title="Virtual Devices"
      subtitle="Add extra floating phone mockups. Each enabled device shows as a button in the website's '+' launcher."
      endpoint="/v1/admin/table/web_virtual_devices"
    />
  );
}
