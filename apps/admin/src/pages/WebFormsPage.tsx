import { AdminTable } from "@/components/admin/AdminTable";

export default function WebFormsPage() {
  return (
    <AdminTable
      title="Custom Forms · Lead Capture"
      subtitle="Each form gets a public URL: /f/<slug>. Submissions viewable in Lookup → Forms (existing module)."
      endpoint="/v1/admin/table/web_forms"
    />
  );
}
