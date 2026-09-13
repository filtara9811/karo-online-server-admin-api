import { AdminTable } from "@/components/admin/AdminTable";

export default function WebMediaPage() {
  return (
    <AdminTable
      title="Media Library"
      subtitle="Reusable images, with alt text for SEO."
      endpoint="/v1/admin/table/web_media_assets"
    />
  );
}
