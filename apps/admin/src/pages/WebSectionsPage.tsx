import { AdminTable } from "@/components/admin/AdminTable";

export default function WebSectionsPage() {
  return (
    <AdminTable
      title="Content Blocks"
      subtitle="Reusable blocks per page. Order by 'sort_order'."
      endpoint="/v1/admin/table/web_content_blocks"
    />
  );
}
