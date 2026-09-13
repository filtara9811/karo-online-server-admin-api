import { AdminTable } from "@/components/admin/AdminTable";

export default function WebApkPage() {
  return (
    <AdminTable
      title="APK / Download Manager"
      subtitle="Upload APK file directly (up to 200 MB) or paste Play Store / Drive link. Mark one row per audience as 'Current'."
      endpoint="/v1/admin/table/web_apk_releases"
    />
  );
}
