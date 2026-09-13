import { AdminTable } from "@/components/admin/AdminTable";

export default function WebFaqsPage() {
  return (
    <AdminTable
      title="FAQs"
      subtitle="Per-page Q&A. Shown in marketing pages."
      endpoint="/v1/admin/table/web_faqs"
    />
  );
}
