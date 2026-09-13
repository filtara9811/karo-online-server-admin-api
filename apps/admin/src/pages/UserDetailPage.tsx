import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Loader2,
  User as UserIcon,
  Store,
  Wallet as WalletIcon,
  ShieldCheck,
  Hash,
  Ban,
} from "lucide-react";
import { apiFetch, asRecord, bool, num, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldCard } from "@/components/admin/AdminLayout";

type Tab = "profile" | "vendor" | "wallet" | "activity";

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("profile");

  const q = useQuery({
    queryKey: ["admin-user", userId],
    enabled: !!userId,
    queryFn: async () => asRecord(await apiFetch(`/v1/admin/users/${userId}`)),
  });

  if (q.isLoading) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-[#d4af37]" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <ErrorBanner
        message={q.error instanceof Error ? q.error.message : "User load fail"}
        onRetry={() => q.refetch()}
      />
    );
  }

  const data = q.data ?? {};
  const customer = asRecord(data.customer ?? data);
  if (!str(customer.id ?? customer.user_id ?? userId)) {
    return (
      <GoldCard className="p-8 text-center">
        <p className="text-[#f5d97a]/70">User not found.</p>
        <button
          onClick={() => navigate("/customers")}
          className="mt-3 text-[#d4af37] underline text-sm"
        >
          Back to customers
        </button>
      </GoldCard>
    );
  }

  const vendor = data.vendor && typeof data.vendor === "object" ? asRecord(data.vendor) : null;
  const wallet = asRecord(data.wallet);
  const leads = Array.isArray(data.leads) ? data.leads : [];
  const referrals = Array.isArray(data.referrals) ? data.referrals : [];
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];

  return (
    <>
      <Link
        to="/lookup"
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/70 hover:text-[#f5d97a] mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> Back to Lookup
      </Link>

      <GoldCard className="p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#fff8dc] to-[#d4af37] grid place-items-center font-bold text-[#1a1a1a]">
            {str(customer.name || customer.email || "?", "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-xl font-bold text-[#f5d97a]">
                {str(customer.name, "User")}
              </h2>
              {customer.support_code != null && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40 font-mono inline-flex items-center gap-0.5">
                  <Hash className="h-2.5 w-2.5" />
                  {String(customer.support_code)}
                </span>
              )}
              {bool(customer.is_blocked) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                  BLOCKED
                </span>
              )}
            </div>
            <p className="text-xs text-[#f5d97a]/70">
              {str(customer.phone, "—")} · {str(customer.email, "—")}
            </p>
          </div>
        </div>
      </GoldCard>

      <div className="flex gap-1 p-2 border-b border-[#d4af37]/15 overflow-x-auto mb-4">
        {(
          [
            { k: "profile", l: "Profile", I: UserIcon },
            { k: "vendor", l: vendor ? "Vendor" : "Vendor (–)", I: Store },
            { k: "wallet", l: "Wallet", I: WalletIcon },
            { k: "activity", l: "Activity", I: ShieldCheck },
          ] as const
        ).map(({ k, l, I }) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap ${
              tab === k ? "bg-[#d4af37] text-[#1a1a1a]" : "text-[#f5d97a]/70 hover:bg-white/5"
            }`}
          >
            <I className="h-3.5 w-3.5" /> {l}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <GoldCard className="p-4 grid sm:grid-cols-2 gap-3 text-sm">
          {(
            [
              ["Name", customer.name],
              ["Gender", customer.gender],
              ["Phone", customer.phone],
              ["Email", customer.email],
              ["Address", customer.address],
              ["Verified", bool(customer.verified) ? "yes" : "no"],
              ["Notes", customer.admin_notes],
            ] as [string, unknown][]
          ).map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] uppercase tracking-wide text-[#f5d97a]/60">{label}</p>
              <p className="text-[#fff8dc] mt-0.5">{str(value, "—")}</p>
            </div>
          ))}
        </GoldCard>
      )}

      {tab === "vendor" &&
        (vendor ? (
          <GoldCard className="p-4 grid sm:grid-cols-2 gap-3 text-sm">
            {(
              [
                ["Business", vendor.business_name],
                ["Owner", vendor.owner_name],
                ["Trade", vendor.trade],
                ["Deals in", vendor.deals_in],
                ["WhatsApp", vendor.whatsapp],
                ["GST", vendor.gst],
                ["PAN", vendor.pan],
                ["Plan", vendor.plan],
                ["Status", vendor.status],
              ] as [string, unknown][]
            ).map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] uppercase tracking-wide text-[#f5d97a]/60">{label}</p>
                <p className="text-[#fff8dc] mt-0.5">{str(value, "—")}</p>
              </div>
            ))}
          </GoldCard>
        ) : (
          <p className="text-sm text-[#f5d97a]/60 text-center py-6">Yeh user vendor nahi hai.</p>
        ))}

      {tab === "wallet" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <GoldCard className="p-3">
              <p className="text-[11px] uppercase text-[#f5d97a]/60">LeadX Coins</p>
              <p className="text-2xl font-bold text-[#f5d97a]">{num(wallet.leadx_coins)}</p>
            </GoldCard>
            <GoldCard className="p-3">
              <p className="text-[11px] uppercase text-[#f5d97a]/60">Service Wallet</p>
              <p className="text-2xl font-bold text-[#f5d97a]">
                ₹{(num(wallet.service_balance_paise) / 100).toFixed(2)}
              </p>
            </GoldCard>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#f5d97a] mb-2">Recent transactions</p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {transactions.length === 0 && <p className="text-xs text-[#f5d97a]/40">None</p>}
              {transactions.map((t) => {
                const row = asRecord(t);
                return (
                  <div key={str(row.id)} className="flex justify-between text-xs p-2 rounded bg-black/30">
                    <div>
                      <p className="text-[#f5d97a]">
                        {str(row.txn_type)} <span className="text-[#f5d97a]/50">· {str(row.wallet_kind)}</span>
                      </p>
                      <p className="text-[#f5d97a]/50">
                        {row.created_at ? new Date(str(row.created_at)).toLocaleString() : "—"}
                      </p>
                    </div>
                    <p className={row.direction === "credit" ? "text-emerald-400" : "text-red-400"}>
                      {row.direction === "credit" ? "+" : "–"}
                      {str(row.coins ?? (row.amount_paise ? `₹${(num(row.amount_paise) / 100).toFixed(2)}` : 0))}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-[#f5d97a] mb-2">Recent leads ({leads.length})</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {leads.map((l) => {
                const row = asRecord(l);
                return (
                  <div
                    key={str(row.id)}
                    className="text-xs p-2 rounded bg-black/30 text-[#f5d97a]/80 flex justify-between"
                  >
                    <span>
                      {str(row.sub_category_name)} · {str(row.status)}
                    </span>
                    <span className="text-[#f5d97a]/40">
                      {row.created_at ? new Date(str(row.created_at)).toLocaleDateString() : ""}
                    </span>
                  </div>
                );
              })}
              {leads.length === 0 && <p className="text-xs text-[#f5d97a]/40">None</p>}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#f5d97a] mb-2">Referrals ({referrals.length})</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {referrals.map((r) => {
                const row = asRecord(r);
                return (
                  <div key={str(row.id)} className="text-xs p-2 rounded bg-black/30 text-[#f5d97a]/80">
                    {str(row.status)} ·{" "}
                    {row.created_at ? new Date(str(row.created_at)).toLocaleDateString() : ""}
                  </div>
                );
              })}
              {referrals.length === 0 && <p className="text-xs text-[#f5d97a]/40">None</p>}
            </div>
          </div>
          <div className="pt-4 border-t border-red-500/20">
            <p className="text-xs font-semibold text-red-400 mb-2">Danger zone</p>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/20 text-red-200 text-sm font-bold">
              <Ban className="h-4 w-4" />{" "}
              {bool(customer.is_blocked) ? "User is blocked" : "User is active"}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
