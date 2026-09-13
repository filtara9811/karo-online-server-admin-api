import { AdminTable } from "@/components/admin/AdminTable";

export default function NotificationsPage() {
  return (
    <AdminTable
      title="Notification Engine"
      subtitle="Campaigns, segmentation, push triggers, delivery logs & analytics"
      endpoint="/v1/admin/table/notification_campaigns"
    />
  );
}
