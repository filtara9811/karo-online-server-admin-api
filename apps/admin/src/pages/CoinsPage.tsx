import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MessageCircle, Save } from "lucide-react";
import { apiFetch, asList, str } from "@/lib/api";
import { AdminTable } from "@/components/admin/AdminTable";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard } from "@/components/admin/AdminLayout";

/** Coins a vendor pays to reply to a customer who messaged them from their profile (0 = free). */
function ChatCreditCard() {
  const [coins, setCoins] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-table", "app_settings"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/app_settings")),
  });

  useEffect(() => {
    if (!q.data) return;
    const row = q.data.find((r) => str(r.key) === "chat_credit_coins");
    const v = row?.value;
    const num = Number(v != null && typeof v === "object" ? (v as { coins?: unknown }).coins : v);
    setCoins(Number.isFinite(num) ? String(num) : "0");
  }, [q.data]);

  const save = async () => {
    const n = Number(coins);
    if (!Number.isFinite(n) || n < 0) {
      setErr("Enter 0 or a positive number of coins");
      return;
    }
    setSaving(true);
    setErr(null);
    setOkMsg(null);
    try {
      await apiFetch("/v1/admin/table/app_settings", {
        method: "POST",
        body: JSON.stringify({ key: "chat_credit_coins", value: Math.ceil(n) }),
      });
      setOkMsg(n === 0 ? "Profile chats are now free for vendors" : `Vendors now pay ${Math.ceil(n)} coin${n === 1 ? "" : "s"} per new chat`);
      q.refetch();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <GoldCard className="p-5 space-y-3 max-w-2xl mb-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg grid place-items-center bg-black/40 border border-[#d4af37]/30 flex-shrink-0">
          <MessageCircle className="h-5 w-5 text-[#d4af37]" />
        </div>
        <div>
          <h3 className="text-sm uppercase tracking-widest text-[#d4af37] font-bold">Chat credit</h3>
          <p className="text-xs text-[#fff8dc]/70">
            LeadX coins a vendor pays the first time they reply to a customer who messaged them from their profile or shop page.
            Regular lead chats are not charged. Set 0 to make it free.
          </p>
        </div>
      </div>
      {err && <ErrorBanner message={err} />}
      {okMsg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{okMsg}</div>
      )}
      <div className="flex items-end gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[#d4af37]/70 font-bold">Coins per new chat</label>
          <input
            type="number"
            min={0}
            step={1}
            value={coins}
            disabled={q.isLoading}
            onChange={(e) => setCoins(e.target.value)}
            className="block w-40 mt-0.5 px-3 py-2 rounded-lg bg-black/40 border border-[#d4af37]/30 text-[#fff8dc] outline-none focus:border-[#d4af37] text-sm"
          />
        </div>
        <GoldButton onClick={save} disabled={saving || q.isLoading}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </GoldButton>
      </div>
    </GoldCard>
  );
}

export default function CoinsPage() {
  return (
    <div>
      <ChatCreditCard />
      <AdminTable
        title="LeadX Market"
        subtitle="Live supply, circulation & vendor holdings"
        endpoint="/v1/admin/table/coin_pricing_config"
      />
    </div>
  );
}
