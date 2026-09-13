import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock, Loader2, Crown, ShieldCheck, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setHasSession(!!data.session);
      setReady(true);
    };
    const t = setTimeout(check, 300);
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (cancelled) return;
      setHasSession(!!sess);
      setReady(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (pwd.length < 6) {
      setError("Password kam se kam 6 characters ka hona chahiye.");
      return;
    }
    if (pwd !== pwd2) {
      setError("Dono passwords match nahi kar rahe.");
      return;
    }
    setLoading(true);
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password: pwd });
      if (upErr) throw upErr;
      setInfo("Password update ho gaya. Aap ab login kar sakte hain.");
      setTimeout(() => {
        supabase.auth.signOut().then(() => navigate("/login"));
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Password update fail ho gaya.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-10"
      style={{
        background:
          "radial-gradient(circle at 20% 10%, oklch(0.22 0.04 80) 0%, oklch(0.12 0.02 80) 60%, oklch(0.08 0.01 80) 100%)",
      }}
    >
      <Link
        to="/login"
        className="absolute top-5 left-5 flex items-center gap-1.5 text-xs uppercase tracking-[0.25em] text-[#f5d97a]/80 hover:text-[#f5d97a]"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Login
      </Link>

      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div
            className="h-16 w-16 rounded-2xl grid place-items-center mb-3 border border-[#d4af37]/40"
            style={{
              background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)",
            }}
          >
            <Crown className="h-8 w-8 text-[#1a1208]" strokeWidth={2.2} />
          </div>
          <h1
            className="font-display text-2xl font-bold"
            style={{
              background: "linear-gradient(180deg, #fff8dc 0%, #f5d97a 50%, #d4af37 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Set New Password
          </h1>
        </div>

        <div
          className="rounded-3xl p-6 backdrop-blur-xl border"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,253,245,0.08) 0%, rgba(255,253,245,0.04) 100%)",
            borderColor: "rgba(212,175,55,0.35)",
          }}
        >
          {!ready ? (
            <div className="py-10 grid place-items-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
            </div>
          ) : !hasSession ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-red-200">Reset link invalid ya expire ho gaya hai.</p>
              <Link
                to="/login"
                className="inline-block text-xs uppercase tracking-widest text-[#f5d97a] underline"
              >
                Naya reset link request kariye
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold flex items-center gap-1.5 mb-1.5">
                  <Lock className="h-3 w-3" /> New Password
                </label>
                <input
                  type="password"
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  placeholder="Min 6 characters"
                  minLength={6}
                  className="w-full px-4 py-3 rounded-xl bg-black/40 border border-[#d4af37]/30 text-[#fff8dc] outline-none focus:border-[#d4af37] text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold flex items-center gap-1.5 mb-1.5">
                  <Lock className="h-3 w-3" /> Confirm Password
                </label>
                <input
                  type="password"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  minLength={6}
                  className="w-full px-4 py-3 rounded-xl bg-black/40 border border-[#d4af37]/30 text-[#fff8dc] outline-none focus:border-[#d4af37] text-sm"
                />
              </div>

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
                className="w-full py-3.5 rounded-xl font-bold text-base text-[#1a1208] flex items-center justify-center gap-2 disabled:opacity-60"
                style={{
                  background: "linear-gradient(180deg, #fff8dc 0%, #f5d97a 35%, #d4af37 100%)",
                }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Update Password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
