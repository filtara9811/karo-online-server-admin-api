import { AdminTable } from "@/components/admin/AdminTable";

export default function VideoPage() {
  return (
    <AdminTable
      title="🎬 Onboarding Video Control"
      subtitle="Manage the background video shown on the vendor onboarding / join screen. Paste a YouTube link, a direct MP4/WEBM URL, or upload a file."
      endpoint="/v1/admin/table/oneqr_tutorial_videos"
    />
  );
}
