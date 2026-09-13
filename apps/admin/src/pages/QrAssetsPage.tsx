import { AdminTable } from "@/components/admin/AdminTable";

export default function QrAssetsPage() {
  return (
    <AdminTable
      title="QR Assets & Printing"
      subtitle="Design, print and assign branded QR batches"
      endpoint="/v1/admin/table/qr_batches"
    />
  );
}
