import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import {
  Crown,
  LayoutDashboard,
  Users,
  Store,
  FolderTree,
  Shield,
  CreditCard,
  MessageSquare,
  MessageCircle,
  Truck,
  Coins,
  FileText,
  Globe,
  Gift,
  Zap,
  Flame,
  Map as MapIcon,
  Bell,
  ShieldCheck,
  ClipboardList,
  Palette,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
  Loader2,
  QrCode,
  Search,
  KeyRound,
  Activity,
  Smartphone,
  UserCog,
  ScanLine,
  Video,
} from "lucide-react";
import { apiFetch, extractRoles, isAdminRoles, type AdminMe } from "@/lib/api";
import { clearLocalSession, getLocalSession } from "@/lib/local-session";
import { ThemeToggle } from "@/theme";
import { ErrorBanner } from "./ErrorBanner";
import { FloatingPhoneMockup } from "./FloatingPhoneMockup";

type NavItem = { to: string; label: string; icon: typeof Crown };
type NavGroup = { title: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/leads", label: "All Leads", icon: ClipboardList },
      { to: "/lookup", label: "User Lookup", icon: Search },
    ],
  },
  {
    title: "People",
    items: [
      { to: "/customers", label: "Customers", icon: Users },
      { to: "/vendors", label: "Vendors", icon: Store },
      { to: "/staff", label: "Staff & Roles", icon: Shield },
      { to: "/staff-ops", label: "Staff Ops", icon: UserCog },
      { to: "/kyc", label: "KYC Verification", icon: ShieldCheck },
      { to: "/kyc-review", label: "KYC Submissions", icon: ClipboardList },
    ],
  },
  {
    title: "QR & Shops",
    items: [
      { to: "/one-qr", label: "One QR Business", icon: QrCode },
      { to: "/qr-assets", label: "QR Management", icon: ScanLine },
      { to: "/subscription", label: "Subscriptions", icon: Crown },
      { to: "/scan-insights", label: "Scan Insights", icon: Activity },
    ],
  },
  {
    title: "Payments",
    items: [
      { to: "/payments", label: "Payment Gateways", icon: CreditCard },
      { to: "/cashfree", label: "Cashfree", icon: Zap },
      { to: "/coins", label: "LeadX Market", icon: Coins },
      { to: "/referrals", label: "Referral Program", icon: Gift },
      { to: "/logistics", label: "Delivery Gateways", icon: Truck },
    ],
  },
  {
    title: "Communication",
    items: [
      { to: "/sms", label: "SMS Gateways", icon: MessageSquare },
      { to: "/whatsapp", label: "WhatsApp API", icon: MessageCircle },
      { to: "/communication", label: "Voice + Comm Hub", icon: MessageCircle },
      { to: "/notifications", label: "Notifications", icon: Bell },
      { to: "/firebase", label: "Firebase", icon: Flame },
    ],
  },
  {
    title: "System",
    items: [
      { to: "/maps", label: "Maps Providers", icon: MapIcon },
      { to: "/api-keys", label: "API Management", icon: KeyRound },
      { to: "/system-status", label: "System Status", icon: Activity },
      { to: "/devices", label: "Device Unlock", icon: Smartphone },
      { to: "/test-accounts", label: "Test Accounts", icon: ShieldCheck },
    ],
  },
  {
    title: "Content",
    items: [
      { to: "/catalog", label: "Catalog", icon: FolderTree },
      { to: "/forms", label: "Form Builder", icon: ClipboardList },
      { to: "/branding", label: "Branding Studio", icon: Palette },
      { to: "/legal", label: "Legal Pages", icon: FileText },
      { to: "/web", label: "Special Web CMS", icon: Globe },
      { to: "/home-content", label: "Home Banners", icon: LayoutDashboard },
      { to: "/onboarding", label: "Onboarding", icon: LayoutDashboard },
      { to: "/video", label: "Onboarding Video", icon: Video },
      { to: "/settings", label: "App Settings", icon: SettingsIcon },
      { to: "/feedback", label: "Feedback", icon: MessageSquare },
    ],
  },
];

const GOLD_GRAD = "linear-gradient(180deg, #fff8dc 0%, #f5d97a 35%, #d4af37 100%)";

function publicSiteUrl() {
  const env = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, "");
  if (env) return env;
  if (typeof window !== "undefined" && window.location.port === "5173") return "http://localhost:4000";
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function AdminLayout({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const isEmbed =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = getLocalSession();
      const user = local ? { id: "local", email: local.email ?? null } : null;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }
      try {
        const me = await apiFetch<AdminMe>("/v1/admin/me");
        const r = extractRoles(me);
        const ok = r.length === 0 || isAdminRoles(r);
        if (!ok) {
          clearLocalSession();
          navigate("/login", { replace: true });
          return;
        }
        if (cancelled) return;
        setEmail(me.email ?? me.user?.email ?? user.email ?? null);
        setRoles(r.length ? r : ["admin"]);
        setBootError(null);
        setLoading(false);
      } catch (err: unknown) {
        const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 0;
        if (status === 401 || status === 403) {
          clearLocalSession();
          navigate("/login", { replace: true });
          return;
        }
        if (cancelled) return;
        setEmail(user.email ?? null);
        setRoles(["admin"]);
        setBootError(err instanceof Error ? err.message : "Admin session verify fail.");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const logout = async () => {
    clearLocalSession();
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center" style={{ background: "var(--admin-page-bg)" }}>
        <Loader2 className="h-8 w-8 animate-spin text-[#d4af37]" />
      </div>
    );
  }

  const topRole = roles.includes("super_admin")
    ? "SUPER ADMIN"
    : roles.includes("admin")
      ? "ADMIN"
      : roles.includes("moderator")
        ? "MODERATOR"
        : "SUPPORT";

  const Sidebar = (
    <aside
      className="h-full w-72 flex flex-col border-r"
      style={{
        background: "var(--admin-sidebar-bg)",
        borderColor: "var(--admin-sidebar-border)",
      }}
    >
      <div className="px-5 py-5 flex items-center gap-3 border-b" style={{ borderColor: "var(--admin-sidebar-border)" }}>
        <div
          className="relative overflow-hidden h-11 w-11 rounded-xl grid place-items-center shrink-0"
          style={{
            background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)",
            boxShadow: "0 8px 24px -8px rgba(212,175,55,0.55)",
          }}
        >
          <span className="gold-shine" aria-hidden />
          <Crown className="relative z-[2] h-5 w-5 text-[#1a1208]" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold leading-tight truncate admin-title">Admin Panel</h1>
          <p className="text-[10px] uppercase tracking-[0.25em] mt-0.5" style={{ color: "var(--admin-muted)" }}>
            {topRole}
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="lg:hidden ml-auto p-2 rounded-lg hover:bg-[#d4af37]/10"
          style={{ color: "var(--admin-nav)" }}
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p
              className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.22em]"
              style={{ color: "var(--admin-section)" }}
            >
              {group.title}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive =
                  item.to === "/"
                    ? location.pathname === "/"
                    : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`relative overflow-hidden flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold transition ${
                      isActive ? "text-[#1a1208]" : "hover:bg-[#d4af37]/10"
                    }`}
                    style={
                      isActive
                        ? {
                            background: GOLD_GRAD,
                            boxShadow:
                              "0 8px 24px -10px rgba(212,175,55,0.6), inset 0 1px 0 rgba(255,255,255,0.4)",
                          }
                        : { color: "var(--admin-nav)" }
                    }
                  >
                    {isActive && <span className="gold-shine" aria-hidden />}
                    <Icon className="relative z-[2] h-4 w-4 shrink-0" />
                    <span className="relative z-[2] truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 py-4 border-t space-y-3" style={{ borderColor: "var(--admin-sidebar-border)" }}>
        <ThemeToggle />
        <Link
          to="/profile"
          className="block rounded-xl px-3 py-2.5 border hover:bg-[#d4af37]/10 transition"
          style={{ borderColor: "var(--admin-sidebar-border)", background: "var(--admin-signed-bg)" }}
        >
          <p className="text-[9px] uppercase tracking-[0.3em] mb-0.5" style={{ color: "var(--admin-muted)" }}>
            Signed in as · Tap to manage
          </p>
          <p className="text-xs truncate font-medium" style={{ color: "var(--admin-ink)" }}>
            {email}
          </p>
        </Link>
        <button
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold uppercase tracking-widest hover:bg-[#d4af37]/10 transition"
          style={{ borderColor: "var(--admin-sidebar-border)", color: "var(--admin-nav)" }}
        >
          <LogOut className="h-3.5 w-3.5" /> Logout
        </button>
        <a
          href={publicSiteUrl() || "/"}
          target="_blank"
          rel="noreferrer"
          className="block text-center text-[9px] uppercase tracking-[0.3em] hover:text-[#d4af37]"
          style={{ color: "var(--admin-section)" }}
        >
          Open website
        </a>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex" style={{ background: "var(--admin-page-bg)" }}>
      <div className="hidden lg:block sticky top-0 h-screen">{Sidebar}</div>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative h-full">{Sidebar}</div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header
          className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 border-b backdrop-blur-xl"
          style={{
            background: "var(--admin-header-bg)",
            borderColor: "var(--admin-sidebar-border)",
          }}
        >
          <button
            onClick={() => setOpen(true)}
            className="p-2 rounded-lg hover:bg-[#d4af37]/10"
            style={{ color: "var(--admin-nav)" }}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            to="/profile"
            className="h-9 w-9 rounded-lg grid place-items-center"
            style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
            aria-label="Profile"
          >
            <Crown className="h-4 w-4 text-[#1a1208]" />
          </Link>
          <h1 className="font-display text-base font-bold admin-title">Admin Panel</h1>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle compact />
            <Link
              to="/profile"
              className="text-[9px] uppercase tracking-[0.25em] font-bold px-2 py-1 rounded-full border hover:bg-[#d4af37]/10"
              style={{ color: "var(--admin-nav)", borderColor: "var(--admin-sidebar-border)" }}
            >
              {topRole}
            </Link>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 max-w-[1400px] w-full mx-auto">
          {bootError && (
            <div className="mb-4">
              <ErrorBanner message={bootError} />
            </div>
          )}
          {children ?? <Outlet />}
        </main>
      </div>
      {!isEmbed && <FloatingPhoneMockup />}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div>
        <h2 className="font-display text-2xl sm:text-3xl font-bold admin-title">{title}</h2>
        {subtitle && (
          <p className="text-xs mt-1" style={{ color: "var(--admin-muted)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function GoldCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border backdrop-blur-xl ${className}`}
      style={{
        background: "var(--admin-card-bg)",
        borderColor: "var(--admin-card-border)",
      }}
    >
      <span className="gold-shine" aria-hidden />
      {children}
    </div>
  );
}

export function GoldButton({
  children,
  onClick,
  type = "button",
  disabled,
  variant = "primary",
  size = "md",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  variant?: "primary" | "outline" | "danger";
  size?: "sm" | "md";
  className?: string;
}) {
  const sz = size === "sm" ? "px-3 py-1.5 text-[11px]" : "px-4 py-2.5 text-xs";
  if (variant === "primary") {
    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        className={`relative overflow-hidden ${sz} rounded-xl font-bold uppercase tracking-widest text-[#1a1208] disabled:opacity-50 active:scale-[0.98] transition ${className}`}
        style={{
          background: GOLD_GRAD,
          boxShadow: "0 8px 24px -10px rgba(212,175,55,0.6)",
        }}
      >
        <span className="gold-shine" aria-hidden />
        <span className="relative z-[2]">{children}</span>
      </button>
    );
  }
  if (variant === "danger") {
    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        className={`${sz} rounded-xl font-bold uppercase tracking-widest border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition ${className}`}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${sz} rounded-xl font-bold uppercase tracking-widest border hover:bg-[#d4af37]/10 disabled:opacity-50 transition ${className}`}
      style={{ borderColor: "var(--admin-card-border)", color: "var(--admin-nav)" }}
    >
      {children}
    </button>
  );
}

export function GoldToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left"
      style={{ background: "var(--admin-input-bg)", borderColor: "var(--admin-card-border)" }}
    >
      <span className="text-[10px] uppercase tracking-[0.2em] font-bold" style={{ color: "var(--admin-nav)" }}>
        {label}
      </span>
      <div
        className={`relative h-5 w-9 rounded-full transition ${value ? "" : "bg-black/20"}`}
        style={
          value
            ? { background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }
            : undefined
        }
      >
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            value ? "left-[18px]" : "left-0.5"
          }`}
        />
      </div>
    </button>
  );
}

export const inputCls = "admin-input";
