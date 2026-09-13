import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Store,
  FolderTree,
  Shield,
  CreditCard,
  TrendingUp,
  Ban,
  Calendar,
  Sparkles,
  Truck,
  Coins,
} from "lucide-react";
import { apiFetch, asRecord, num } from "@/lib/api";
import { AnimatedNumber } from "@/components/admin/AnimatedNumber";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldCard, PageHeader } from "@/components/admin/AdminLayout";

type Bucket = { total: number; week: number; month: number; blocked: number };
type Stats = {
  customers: Bucket;
  vendors: Bucket;
  staff: Bucket;
  categories: number;
  activeGateways: number;
  activeLogistics: number;
  coinRate: number;
};

const ZERO: Bucket = { total: 0, week: 0, month: 0, blocked: 0 };

function bucket(v: unknown): Bucket {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    total: num(o.total),
    week: num(o.week),
    month: num(o.month),
    blocked: num(o.blocked),
  };
}

export default function DashboardPage() {
  const q = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const raw = asRecord(await apiFetch("/v1/admin/stats"));
      return {
        customers: bucket(raw.customers),
        vendors: bucket(raw.vendors),
        staff: bucket(raw.staff),
        categories: num(raw.categories ?? raw.catalog),
        activeGateways: num(raw.activeGateways ?? raw.gateways),
        activeLogistics: num(raw.activeLogistics ?? raw.logistics),
        coinRate: num(raw.coinRate ?? raw.coin_rate_inr),
      } satisfies Stats;
    },
  });

  const stats = q.data ?? {
    customers: ZERO,
    vendors: ZERO,
    staff: ZERO,
    categories: 0,
    activeGateways: 0,
    activeLogistics: 0,
    coinRate: 0,
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={q.isLoading ? "Loading live counts…" : "Live overview of your platform"}
      />

      {q.isError && (
        <div className="mb-4">
          <ErrorBanner
            message={q.error instanceof Error ? q.error.message : "Stats load fail"}
            onRetry={() => q.refetch()}
          />
        </div>
      )}

      {q.isLoading ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
            <GoldCard className="h-40 gold-shimmer-bar" />
            <GoldCard className="h-40 gold-shimmer-bar" />
            <GoldCard className="h-40 gold-shimmer-bar" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <GoldCard className="h-20 gold-shimmer-bar" />
            <GoldCard className="h-20 gold-shimmer-bar" />
            <GoldCard className="h-20 gold-shimmer-bar" />
            <GoldCard className="h-20 gold-shimmer-bar" />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
            <PeopleCard label="Customers" icon={Users} to="/customers" bucket={stats.customers} />
            <PeopleCard label="Vendors" icon={Store} to="/vendors" bucket={stats.vendors} />
            <PeopleCard label="Staff" icon={Shield} to="/staff" bucket={stats.staff} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <SmallCard label="Catalog Items" value={stats.categories} icon={FolderTree} to="/catalog" />
            <SmallCard label="Pay Gateways" value={stats.activeGateways} icon={CreditCard} to="/payments" />
            <SmallCard label="Logistics Live" value={stats.activeLogistics} icon={Truck} to="/logistics" />
            <SmallCard label="Coin Rate ₹" value={stats.coinRate} icon={Coins} to="/coins" />
          </div>
        </>
      )}

      <GoldCard className="mt-6 p-6">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-[#d4af37]" />
          <h3 className="font-display text-xl font-bold admin-title">
            Welcome to your Super Admin Panel
          </h3>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: "var(--admin-muted)" }}>
          Yahan se aap har user ko manage kar sakte hain — customers, vendors, staff. Kisi ko
          block/unblock kar sakte hain, profile edit kar sakte hain, aur weekly/monthly growth
          track kar sakte hain.
        </p>
      </GoldCard>
    </>
  );
}

function PeopleCard({
  label,
  icon: Icon,
  to,
  bucket: b,
}: {
  label: string;
  icon: typeof Users;
  to: string;
  bucket: Bucket;
}) {
  return (
    <Link to={to}>
      <GoldCard className="p-5 h-full hover:scale-[1.01] active:scale-[0.99] transition cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <div
            className="relative overflow-hidden h-11 w-11 rounded-xl grid place-items-center"
            style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
          >
            <span className="gold-shine" aria-hidden />
            <Icon className="relative z-[2] h-5 w-5 text-[#1a1208]" />
          </div>
          <TrendingUp className="h-4 w-4 text-[#d4af37]/60" />
        </div>
        <AnimatedNumber
          value={b.total}
          className="font-display text-4xl font-bold leading-none block admin-title"
          digits={0}
        />
        <p className="text-[10px] uppercase tracking-[0.25em] font-bold mt-2" style={{ color: "var(--admin-muted)" }}>
          Total {label}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-1.5">
          <Pill icon={Calendar} label="7d" value={b.week} />
          <Pill icon={Calendar} label="30d" value={b.month} />
          <Pill icon={Ban} label="Blocked" value={b.blocked} danger />
        </div>
      </GoldCard>
    </Link>
  );
}

function Pill({
  icon: Icon,
  label,
  value,
  danger,
}: {
  icon: typeof Calendar;
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div
      className="rounded-lg border px-2 py-1.5 text-center"
      style={{
        background: danger ? "rgba(239,68,68,0.08)" : "rgba(212,175,55,0.08)",
        borderColor: danger ? "rgba(239,68,68,0.3)" : "rgba(212,175,55,0.25)",
      }}
    >
      <div
        className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider"
        style={{ color: danger ? "rgb(220,80,80)" : "var(--admin-muted)" }}
      >
        <Icon className="h-2.5 w-2.5" />
        {label}
      </div>
      <p
        className="font-display text-base font-bold mt-0.5"
        style={{ color: danger ? "rgb(220,80,80)" : "var(--admin-pill)" }}
      >
        {value}
      </p>
    </div>
  );
}

function SmallCard({
  label,
  value,
  icon: Icon,
  to,
}: {
  label: string;
  value: number;
  icon: typeof FolderTree;
  to: string;
}) {
  return (
    <Link to={to}>
      <GoldCard className="p-4 h-full hover:scale-[1.02] active:scale-[0.99] transition cursor-pointer">
        <div className="flex items-center gap-3">
          <div
            className="relative overflow-hidden h-9 w-9 rounded-lg grid place-items-center"
            style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
          >
            <span className="gold-shine" aria-hidden />
            <Icon className="relative z-[2] h-4 w-4 text-[#1a1208]" />
          </div>
          <div>
            <AnimatedNumber
              value={value}
              digits={0}
              className="font-display text-2xl font-bold leading-none block admin-title"
            />
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold mt-1" style={{ color: "var(--admin-muted)" }}>
              {label}
            </p>
          </div>
        </div>
      </GoldCard>
    </Link>
  );
}
