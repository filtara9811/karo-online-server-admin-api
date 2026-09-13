import { AdminTable } from "@/components/admin/AdminTable";

export default function HomeContentPage() {
  return (
    <AdminTable
      title="Home Content"
      subtitle="Banners (auto-slide) and Recommended Videos shown on the customer home screen."
      endpoint="/v1/admin/table/app_settings"
    />
  );
}
