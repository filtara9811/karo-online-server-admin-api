import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QrCode, Loader2, Users, Palette, Link2, MessageCircle, Video } from "lucide-react";
import { apiFetch, asList, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader } from "@/components/admin/AdminLayout";

type Visit = {
  id: string;
  created_at: string;
  source: string | null;
  visitor_name: string | null;
  visitor_phone: string | null;
};

type ThemeRow = {
  key: string;
  name: string;
  preset: string;
  accent_color: string;
  bg_from: string;
  bg_to: string;
  is_premium: boolean;
  is_active: boolean;
};

type MerchantRow = {
  user_id: string;
  landing_theme_key: string | null;
  updated_at: string | null;
};

export default function OneQrPage() {
  const qc = useQueryClient();
  const visitsQ = useQuery({
    queryKey: ["admin-table", "referral_link_visits"],
    queryFn: async () =>
      asList(await apiFetch("/v1/admin/table/referral_link_visits")).map(
        (r): Visit => ({
          id: str(r.id),
          created_at: str(r.created_at),
          source: r.source == null ? null : str(r.source),
          visitor_name: r.visitor_name == null ? null : str(r.visitor_name),
          visitor_phone: r.visitor_phone == null ? null : str(r.visitor_phone),
        }),
      ),
  });
  const themesQ = useQuery({
    queryKey: ["admin-table", "qr_landing_themes"],
    queryFn: async () =>
      asList(await apiFetch("/v1/admin/table/qr_landing_themes")).map(
        (t): ThemeRow => ({
          key: str(t.key ?? t.id),
          name: str(t.name),
          preset: str(t.preset),
          accent_color: str(t.accent_color, "#d4af37"),
          bg_from: str(t.bg_from, "#1a1208"),
          bg_to: str(t.bg_to, "#0a0804"),
          is_premium: bool(t.is_premium),
          is_active: bool(t.is_active),
        }),
      ),
  });
  const projectsQ = useQuery({
    queryKey: ["admin-table", "qr_projects"],
    queryFn: async () =>
      asList(await apiFetch("/v1/admin/table/qr_projects")).map((r) => ({
        id: str(r.id),
        title: str(r.title ?? r.business_name ?? r.name),
        slug: str(r.slug),
        is_paid: bool(r.is_paid),
        share_code: r.share_code == null ? null : str(r.share_code),
        created_at: r.created_at == null ? null : str(r.created_at),
      })),
  });
  const merchantsQ = useQuery({
    queryKey: ["admin-table", "merchant_link_settings"],
    queryFn: async () =>
      asList(await apiFetch("/v1/admin/table/merchant_link_settings")).map(
        (m): MerchantRow => ({
          user_id: str(m.user_id),
          landing_theme_key: m.landing_theme_key == null ? null : str(m.landing_theme_key),
          updated_at: m.updated_at == null ? null : str(m.updated_at),
        }),
      ),
  });

  const toggleTheme = useMutation({
    mutationFn: async (t: ThemeRow) =>
      apiFetch("/v1/admin/table/qr_landing_themes", {
        method: "PATCH",
        body: JSON.stringify({ id: t.key, is_active: !t.is_active }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-table", "qr_landing_themes"] }),
  });

  const visits = visitsQ.data ?? [];
  const themes = themesQ.data ?? [];
  const merchants = merchantsQ.data ?? [];
  const projects = projectsQ.data ?? [];
  const loading = visitsQ.isLoading || themesQ.isLoading || merchantsQ.isLoading || projectsQ.isLoading;
  const err = visitsQ.error || themesQ.error || merchantsQ.error || projectsQ.error;

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const weekAgo = Date.now() - 7 * 864e5;
    const qr = visits.filter((r) => (r.source ?? "qr") === "qr");
    const themeCount = new Map<string, number>();
    merchants.forEach((m) => {
      const k = m.landing_theme_key ?? "default";
      themeCount.set(k, (themeCount.get(k) ?? 0) + 1);
    });
    return {
      totalScans: qr.length,
      today: qr.filter((r) => new Date(r.created_at).toDateString() === today).length,
      week: qr.filter((r) => new Date(r.created_at).getTime() > weekAgo).length,
      leads: qr.filter((r) => r.visitor_phone).length,
      shops: merchants.length,
      themeCount: [...themeCount.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [visits, merchants]);

  return (
    <>
      <PageHeader
        title="One QR Business"
        subtitle="Karo leads + Assan Grow QR projects — one admin, one DigitalOcean database"
        action={
          <Link to="/qr-assets">
            <GoldButton variant="outline" size="sm">
              QR Printing →
            </GoldButton>
          </Link>
        }
      />

      {err && (
        <div className="mb-4">
          <ErrorBanner
            message={err instanceof Error ? err.message : "One QR load fail"}
            onRetry={() => {
              visitsQ.refetch();
              themesQ.refetch();
              merchantsQ.refetch();
              projectsQ.refetch();
            }}
          />
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Total scans" value={stats.totalScans} icon={QrCode} />
            <Stat label="Today" value={stats.today} icon={QrCode} />
            <Stat label="7 days" value={stats.week} icon={QrCode} />
            <Stat label="Captured leads" value={stats.leads} icon={Users} />
            <Stat label="One QR shops" value={stats.shops} icon={Link2} />
          </div>

          <GoldCard className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <QrCode className="h-4 w-4 text-[#d4af37]" />
              <h3 className="font-display font-bold text-[#fff8dc]">Assan Grow QR projects</h3>
            </div>
            <ul className="space-y-2 max-h-[320px] overflow-y-auto">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-xl border border-[#d4af37]/20 bg-black/25 px-3 py-2.5">
                  <div>
                    <p className="text-sm text-[#fff8dc]">{p.title}</p>
                    <p className="text-[11px] text-[#f5d97a]/60">
                      /s/{p.share_code || p.slug}?p={p.slug} · {p.is_paid ? "paid" : "draft"}
                    </p>
                  </div>
                </li>
              ))}
              {projects.length === 0 && <p className="text-xs text-[#f5d97a]/60">No Grow projects yet.</p>}
            </ul>
          </GoldCard>

          <GoldCard className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Palette className="h-4 w-4 text-[#d4af37]" />
              <h3 className="font-display font-bold text-[#fff8dc]">Landing themes</h3>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {themes.map((t) => (
                <div key={t.key} className="rounded-xl overflow-hidden border border-[#d4af37]/25">
                  <div
                    className="h-16"
                    style={{ background: `linear-gradient(160deg, ${t.bg_from}, ${t.bg_to})` }}
                  />
                  <div className="px-3 py-2.5 bg-black/30 flex items-center gap-2">
                    <span
                      className="h-4 w-4 rounded-full shrink-0"
                      style={{ background: t.accent_color }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#fff8dc] truncate">{t.name}</p>
                      <p className="text-[10px] text-[#f5d97a]/60 truncate">
                        {t.preset} · {t.is_premium ? "PRO" : "Free"} ·{" "}
                        {stats.themeCount.find(([k]) => k === t.key)?.[1] ?? 0} shops
                      </p>
                    </div>
                    <GoldButton size="sm" variant={t.is_active ? "primary" : "outline"} onClick={() => toggleTheme.mutate(t)}>
                      {t.is_active ? "Live" : "Off"}
                    </GoldButton>
                  </div>
                </div>
              ))}
              {themes.length === 0 && (
                <p className="text-xs text-[#f5d97a]/60">Koi theme configured nahi hai.</p>
              )}
            </div>
          </GoldCard>

          <GoldCard className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Video className="h-4 w-4 text-[#d4af37]" />
              <h3 className="font-display font-bold text-[#fff8dc]">Sheet tutorial videos</h3>
            </div>
            <p className="mb-3 text-[11px] text-[#f5d97a]/60">
              Har config sheet ke top par shopkeeper ko yeh video dikhega — YouTube link ya MP4 upload.
            </p>
          </GoldCard>

          <GoldCard className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-[#d4af37]" />
              <h3 className="font-display font-bold text-[#fff8dc]">Recent QR visitors</h3>
            </div>
            <ul className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {visits.slice(0, 100).map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-xl border border-[#d4af37]/20 bg-black/25 px-3 py-2.5"
                >
                  <span className="h-8 w-8 rounded-full bg-[#d4af37]/15 grid place-items-center text-[#f5d97a]">
                    <QrCode className="h-4 w-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#fff8dc] truncate">{r.visitor_name || "Anonymous visitor"}</p>
                    <p className="text-[11px] text-[#f5d97a]/60 truncate">
                      {r.visitor_phone ? `+91 ${r.visitor_phone} · ` : ""}
                      {r.source ?? "qr"} ·{" "}
                      {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                    </p>
                  </div>
                  {r.visitor_phone && (
                    <a
                      href={`https://wa.me/91${r.visitor_phone}`}
                      target="_blank"
                      rel="noreferrer"
                      className="h-8 w-8 grid place-items-center rounded-full bg-emerald-500/15 text-emerald-300"
                      aria-label="WhatsApp visitor"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
                  )}
                </li>
              ))}
              {visits.length === 0 && (
                <p className="text-xs text-[#f5d97a]/60">Abhi koi scan record nahi hai.</p>
              )}
            </ul>
          </GoldCard>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof QrCode }) {
  return (
    <GoldCard className="p-4">
      <Icon className="h-4 w-4 text-[#d4af37] mb-2" />
      <p className="text-2xl font-extrabold text-[#fff8dc] leading-none">{value}</p>
      <p className="text-[10px] uppercase tracking-[0.2em] text-[#f5d97a]/60 mt-1.5">{label}</p>
    </GoldCard>
  );
}
