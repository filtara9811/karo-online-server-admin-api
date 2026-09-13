import { AdminTable } from "@/components/admin/AdminTable";

export default function TestAccountsPage() {
  return (
    <AdminTable
      title="Test Accounts (Reviewer Mode)"
      subtitle="Apni marzi se reviewer / Play Store / payment-gateway tester accounts manage karein"
      endpoint="/v1/admin/table/test_accounts"
    />
  );
}
