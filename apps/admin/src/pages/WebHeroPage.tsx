import { AdminTable } from "@/components/admin/AdminTable";

export default function WebHeroPage() {
  return (
    <AdminTable
      title="Hero Banners"
      subtitle="One hero per page slug — first match wins."
      endpoint="/v1/admin/table/web_hero_sections"
    />
  );
}
