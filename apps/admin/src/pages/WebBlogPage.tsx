import { AdminTable } from "@/components/admin/AdminTable";

export default function WebBlogPage() {
  return (
    <AdminTable
      title="Blog · SEO Articles"
      subtitle="Markdown supported. Each post auto-generates JSON-LD BlogPosting schema."
      endpoint="/v1/admin/table/web_blog_posts"
    />
  );
}
