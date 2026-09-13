import { AdminTable } from "@/components/admin/AdminTable";

export default function FormsPage() {
  return (
    <AdminTable
      title="Form Builder"
      subtitle="Customer / Vendor / Staff registration forms — apni marzi se fields add karo"
      endpoint="/v1/admin/table/form_schemas"
    />
  );
}
