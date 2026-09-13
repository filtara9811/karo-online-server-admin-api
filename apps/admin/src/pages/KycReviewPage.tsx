import { AdminTable } from "@/components/admin/AdminTable";

export default function KycReviewPage() {
  return (
    <AdminTable
      title="KYC Submissions"
      subtitle="Customer / Vendor ke documents review karein — approve ya reject"
      endpoint="/v1/admin/table/kyc_verifications"
    />
  );
}
