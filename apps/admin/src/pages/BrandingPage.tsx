import { AdminTable } from "@/components/admin/AdminTable";

export default function BrandingPage() {
  return (
    <AdminTable
      title="Branding Studio"
      subtitle="Colors, fonts, icons, logos — pure app ka look apne haath me"
      endpoint="/v1/admin/table/theme_settings"
    />
  );
}
