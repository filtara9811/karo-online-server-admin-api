import { AdminTable } from "@/components/admin/AdminTable";

export default function ReferralsPage() {
  return (
    <AdminTable
      title="Referral Program"
      subtitle="Banners, campaigns, rewards approval & analytics — full control"
      endpoint="/v1/admin/table/referral_campaigns"
    />
  );
}
