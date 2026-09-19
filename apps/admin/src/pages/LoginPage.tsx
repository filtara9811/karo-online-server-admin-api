import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shield, Mail, Lock, Loader2, ArrowLeft, Crown } from "lucide-react";
import { apiBase, apiFetch, extractRoles, isAdminRoles, type AdminMe } from "@/lib/api";
import { clearLocalSession, getLocalSession, saveLocalSession, clearSupabaseAuthStorage } from "@/lib/local-session";
import { ThemeToggle } from "@/theme";

type Mode = "signin" | "signup" | "forgot";

async function signInViaApi(email: string, password: string): Promise<string> {
  const res = await fetch(`${apiBase()}/v1/auth/admin-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    data?: {
      session?: { access_token?: string; refresh_token?: string };
      user?: { id?: string; email?: string };
    };
  };
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Login failed (${res.status})`);
  }
  const access = body.data?.session?.access_token;
  const refresh = body.data?.session?.refresh_token;
  if (!access || !refresh) throw new Error("Login session missing.");
  clearSupabaseAuthStorage();
  saveLocalSession({
    access_token: access,
    refresh_token: refresh,
    email: body.data?.user?.email ?? email,
  });
  return body.data?.user?.id || "local";
}

async function signUpViaApi(email: string, password: string) {
  const res = await fetch(`${apiBase()}/v1/auth/admin-signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Signup failed (${res.status})`);
  }
}

async function resolveRoleRedirect(): Promise<string> {
  try {
    const me = await apiFetch<AdminMe>("/v1/admin/me");
    const roles = extractRoles(me);
    if (isAdminRoles(roles)) return "/";
    clearLocalSession();
    return "__no_role__";
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/connect nahi|Failed to fetch|NetworkError|API se/i.test(msg)) {
      return "__api_down__";
    }
    clearLocalSession();
    return "__no_role__";
  }
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = getLocalSession() ? "local" : "";
      if (!uid || cancelled) return;
      const target = await resolveRoleRedirect();
      if (cancelled) return;
      if (target === "/") navigate("/");
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (mode === "forgot") {
      if (!email.trim()) {
        setError("Email daaliye.");
        return;
      }
    } else if (!email.trim() || !password) {
      setError("Email aur password dono daaliye.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signin") {
        const uid = await signInViaApi(email.trim(), password);
        if (!uid) throw new Error("Login failed.");

        const target = await resolveRoleRedirect();
        if (target === "__api_down__") {
          setError("API se connect nahi ho paya. localhost:4000 chalu karke retry kariye.");
          setLoading(false);
          return;
        }
        if (target === "__no_role__") {
          setError(
            "Aapke account ko admin access nahi hai. Super Admin se contact kariye.",
          );
          setLoading(false);
          return;
        }
        navigate(target);
      } else if (mode === "signup") {
        await signUpViaApi(email.trim(), password);
        setInfo(
          "Account DigitalOcean pe save ho gaya. Super Admin ko email bhejiye taaki wo aapko role assign kar sakein.",
        );
        setMode("signin");
      } else {
        setInfo(
          "Email delivery DigitalOcean par configured nahi hai. Login karke Profile se password change kariye, ya Super Admin se reset karwayein.",
        );
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Kuch galat ho gaya.";
      setError(
        /failed to fetch|networkerror|load failed/i.test(raw)
          ? "Login server se connect nahi ho paya. Internet aur API (localhost:4000) check karke retry kariye."
          : raw,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-10 relative overflow-hidden"
      style={{ background: "var(--admin-page-bg)", color: "var(--admin-ink)" }}
    >
      <div
        aria-hidden
        className="gold-glow-orb absolute -top-40 -left-40 w-[420px] h-[420px] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, #d4af37 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="gold-glow-orb absolute -bottom-40 -right-40 w-[420px] h-[420px] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, #f5d97a 0%, transparent 70%)", animationDelay: "1.6s" }}
      />

      <Link
        to="/"
        className="absolute top-5 left-5 flex items-center gap-1.5 text-xs uppercase tracking-[0.25em] transition"
        style={{ color: "var(--admin-muted)" }}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to App
      </Link>
      <div className="absolute top-5 right-5">
        <ThemeToggle compact />
      </div>

      <div className="relative w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div
            className="relative overflow-hidden h-16 w-16 rounded-2xl grid place-items-center mb-3 border border-[#d4af37]/40"
            style={{
              background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)",
              boxShadow: "0 10px 40px -8px rgba(212,175,55,0.55)",
            }}
          >
            <span className="gold-shine" aria-hidden />
            <Crown className="relative z-[2] h-8 w-8 text-[#1a1208]" strokeWidth={2.2} />
          </div>
          <p className="text-[10px] uppercase tracking-[0.4em]" style={{ color: "var(--admin-muted)" }}>
            ✦ Restricted Area ✦
          </p>
          <h1 className="font-display text-3xl font-bold mt-1 admin-title">
            Super Admin Panel
          </h1>
          <p className="text-xs mt-1 tracking-wide" style={{ color: "var(--admin-muted)" }}>
            Authorized personnel only
          </p>
        </div>

        <div
          className="relative overflow-hidden rounded-3xl p-6 backdrop-blur-xl border"
          style={{
            background: "var(--admin-card-bg)",
            borderColor: "var(--admin-card-border)",
          }}
        >
          <span className="gold-shine" aria-hidden />
          <div className="flex p-1 rounded-xl mb-5 border" style={{ borderColor: "var(--admin-card-border)", background: "var(--admin-signed-bg)" }}>
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
                setInfo(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition ${
                mode === "signin" ? "text-[#1a1208]" : "hover:opacity-80"
              }`}
              style={
                mode === "signin"
                  ? { background: "linear-gradient(180deg, #fff8dc, #f5d97a, #d4af37)" }
                  : undefined
              }
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
                setInfo(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition ${
                mode === "signup" ? "text-[#1a1208]" : "hover:opacity-80"
              }`}
              style={
                mode === "signup"
                  ? { background: "linear-gradient(180deg, #fff8dc, #f5d97a, #d4af37)" }
                  : undefined
              }
            >
              Request Access
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] font-bold flex items-center gap-1.5 mb-1.5" style={{ color: "var(--admin-muted)" }}>
                <Mail className="h-3 w-3" /> Email
              </label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@yourdomain.com"
                className="admin-input px-4 py-3"
              />
            </div>

            {mode !== "forgot" && (
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] font-bold flex items-center gap-1.5 mb-1.5" style={{ color: "var(--admin-muted)" }}>
                  <Lock className="h-3 w-3" /> Password
                </label>
                <input
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "Min 6 characters" : "••••••••"}
                  minLength={6}
                  className="admin-input px-4 py-3"
                />
              </div>
            )}

            {mode === "signin" && (
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setInfo(null);
                }}
                className="text-[11px] underline-offset-4 hover:underline"
                style={{ color: "var(--admin-muted)" }}
              >
                Forgot password?
              </button>
            )}
            {mode === "forgot" && (
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setInfo(null);
                }}
                className="text-[11px] underline-offset-4 hover:underline"
                style={{ color: "var(--admin-muted)" }}
              >
                ← Back to Sign In
              </button>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-display font-bold text-base text-[#1a1208] flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition relative overflow-hidden"
              style={{
                background: "linear-gradient(180deg, #fff8dc 0%, #f5d97a 35%, #d4af37 100%)",
                boxShadow:
                  "0 10px 30px -8px rgba(212,175,55,0.6), inset 0 1px 0 rgba(255,255,255,0.5)",
              }}
            >
              <span className="gold-shine" aria-hidden />
              <span className="relative z-[2] flex items-center justify-center gap-2">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {mode === "forgot" ? "Sending..." : "Verifying..."}
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4" />
                  {mode === "signin"
                    ? "Enter Admin Panel"
                    : mode === "signup"
                      ? "Request Access"
                      : "How to reset"}
                </>
              )}
              </span>
            </button>
          </form>

          <p className="text-center text-[10px] mt-5 leading-relaxed" style={{ color: "var(--admin-muted)" }}>
            {mode === "signin"
              ? "Dev login: admin@karoonline.local / KaroAdmin@2026"
              : mode === "signup"
                ? "Account DigitalOcean pe save hoga. Super Admin role assign karenge."
                : "Password Profile se change hota hai. Super Admin bhi reset kar sakte hain."}
          </p>
        </div>

        <p className="text-center text-[10px] mt-4 tracking-widest uppercase" style={{ color: "var(--admin-section)" }}>
          Protected session · DigitalOcean Postgres
        </p>
      </div>
    </div>
  );
}
