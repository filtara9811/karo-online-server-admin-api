import { AdminTable } from "@/components/admin/AdminTable";

export default function WebSeoPage() {
  return (
    <AdminTable
      title="SEO · Per Page"
      subtitle="Title, meta, keywords, OG image. Keep keywords lowercase & specific (e.g. 'vendor leads India')."
      endpoint="/v1/admin/table/web_pages"
    />
  );
}
