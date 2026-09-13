import { AdminTable } from "@/components/admin/AdminTable";

export default function StaffOpsPage() {
  return (
    <AdminTable
      title="Staff Operations"
      subtitle="Approve signups, invite via deep link, create staff, assign tasks, process payouts"
      endpoint="/v1/admin/table/staff_tasks"
    />
  );
}
