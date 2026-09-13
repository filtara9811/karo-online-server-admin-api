import { AdminTable } from "@/components/admin/AdminTable";

export default function CommunicationPage() {
  return (
    <AdminTable
      title="Communication Hub"
      subtitle="AI Voice Agent (DialNexa) + per-group WhatsApp/Voice toggles + Voice call log"
      endpoint="/v1/admin/table/voice_providers"
    />
  );
}
