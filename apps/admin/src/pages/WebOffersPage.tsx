import { AdminTable } from "@/components/admin/AdminTable";

export default function WebOffersPage() {
  return (
    <AdminTable
      title="Offer Bar"
      subtitle="Top announcement strip. Latest active row wins."
      endpoint="/v1/admin/table/web_offers"
    />
  );
}
