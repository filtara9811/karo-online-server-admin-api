import { AdminTable } from "@/components/admin/AdminTable";

export default function LegalPage() {
  return (
    <AdminTable
      title="Legal Pages"
      subtitle="Privacy, Terms, Refund & custom pages — content yahan se update hoga"
      endpoint="/v1/admin/table/legal_pages"
    />
  );
}
