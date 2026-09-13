import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Loader2 } from "lucide-react";
import { apiFetch, asList, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader } from "@/components/admin/AdminLayout";

type Plan = {
  id: string;
  name: string;
  price: number | string;
  interval: string;
  is_active: boolean;
  features: string[];
};

export default function SubscriptionPage() {
  const qc = useQueryClient();
  const [onboardingVideo, setOnboardingVideo] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const plansQ = useQuery({
    queryKey: ["admin-table", "vendor_subscription_plans"],
    queryFn: async () =>
      asList(await apiFetch("/v1/admin/table/vendor_subscription_plans")).map(
        (p): Plan => ({
          id: str(p.id),
          name: str(p.name),
          price: (p.price as number | string) ?? 0,
          interval: str(p.interval, "month"),
          is_active: bool(p.is_active),
          features: Array.isArray(p.features) ? p.features.map(String) : [],
        }),
      ),
  });

  const toggle = useMutation({
    mutationFn: async (p: Plan) =>
      apiFetch("/v1/admin/table/vendor_subscription_plans", {
        method: "PATCH",
        body: JSON.stringify({ id: p.id, is_active: !p.is_active }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-table", "vendor_subscription_plans"] }),
  });

  return (
    <>
      <PageHeader
        title="Vendor subscriptions"
        subtitle="Plans and onboarding video shown to vendors when they start Digital Shop / One QR"
      />
      {plansQ.error && <ErrorBanner message={plansQ.error instanceof Error ? plansQ.error.message : "Load fail"} onRetry={() => plansQ.refetch()} />}
      <GoldCard className="p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Crown className="h-4 w-4 text-[#d4af37]" />
          <h3 className="font-display font-bold text-[#fff8dc]">Onboarding video</h3>
        </div>
        <input
          className="w-full rounded-xl bg-black/30 border border-[#d4af37]/25 px-3 py-2 text-sm text-[#fff8dc]"
          value={onboardingVideo}
          onChange={(e) => setOnboardingVideo(e.target.value)}
        />
        <p className="text-[11px] text-[#f5d97a]/60 mt-2">Shown on vendor join and digital-shop autopay. Flutter reads this URL when wired.</p>
      </GoldCard>
      {plansQ.isLoading ? (
        <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" /></div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {(plansQ.data ?? []).map((p) => (
            <GoldCard key={p.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl text-[#fff8dc]">{p.name}</h3>
                  <p className="text-[#f5d97a] mt-1">{typeof p.price === "number" ? `₹${p.price}` : p.price} / {p.interval}</p>
                </div>
                <GoldButton size="sm" variant={p.is_active ? "primary" : "outline"} onClick={() => toggle.mutate(p)}>
                  {p.is_active ? "Live" : "Off"}
                </GoldButton>
              </div>
              <ul className="mt-3 text-sm text-[#f5d97a]/70 space-y-1">
                {p.features.map((f) => <li key={f}>· {f}</li>)}
              </ul>
            </GoldCard>
          ))}
        </div>
      )}
    </>
  );
}
