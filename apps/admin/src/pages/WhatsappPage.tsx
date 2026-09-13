import { AdminTable } from "@/components/admin/AdminTable";

export default function WhatsappPage() {
  return (
    <AdminTable
      title="WhatsApp API"
      subtitle="Fast2SMS Meta WhatsApp + Meta Cloud fallback — templates, live/test mode, failover priority"
      endpoint="/v1/admin/table/whatsapp_providers"
    />
  );
}
