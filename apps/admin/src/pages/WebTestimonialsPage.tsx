import { AdminTable } from "@/components/admin/AdminTable";

export default function WebTestimonialsPage() {
  return (
    <AdminTable
      title="Testimonials & Brand Logos"
      subtitle="Reviews & ratings"
      endpoint="/v1/admin/table/web_testimonials"
    />
  );
}
