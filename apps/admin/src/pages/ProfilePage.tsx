import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Crown, Lock, Mail, LogOut, Loader2, ArrowLeft, User } from "lucide-react";
import { apiFetch, extractRoles, type AdminMe } from "@/lib/api";
import { clearLocalSession, getLocalSession, saveLocalSession } from "@/lib/local-session";
import { GoldButton, GoldCard, PageHeader } from "@/components/admin/AdminLayout";

export default function ProfilePage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newPwd2, setNewPwd2] = useState("");
  const [pwdMsg, setPwdMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const local = getLocalSession();
      if (!local) {
        navigate("/login");
        return;
      }
      setEmail(local.email ?? "");
      setNewEmail(local.email ?? "");
      try {
        const me = await apiFetch<AdminMe>("/v1/admin/me");
        const nextEmail = me.email ?? me.user?.email ?? local.email ?? "";
        setEmail(nextEmail);
        setNewEmail(nextEmail);
        setRoles(extractRoles(me));
      } catch {
        setRoles(["admin"]);
      }
      setLoading(false);
    })();
  }, [navigate]);

  const updateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailMsg(null);
    if (!newEmail.trim() || newEmail.trim() === email) {
      setEmailMsg({ type: "err", text: "Naya email daaliye." });
      return;
    }
    if (!currentPwd) {
      setEmailMsg({ type: "err", text: "Current password daaliye (password box)." });
      return;
    }
    setEmailBusy(true);
    try {
      await apiFetch("/v1/auth/account", {
        method: "PATCH",
        body: JSON.stringify({ current_password: currentPwd, email: newEmail.trim() }),
      });
      const local = getLocalSession();
      if (local) saveLocalSession({ ...local, email: newEmail.trim() });
      setEmail(newEmail.trim());
      setEmailMsg({ type: "ok", text: "Email DigitalOcean pe update ho gaya." });
    } catch (err: unknown) {
      setEmailMsg({ type: "err", text: err instanceof Error ? err.message : "Update fail." });
    } finally {
      setEmailBusy(false);
    }
  };

  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);
    if (newPwd.length < 6) {
      setPwdMsg({ type: "err", text: "Naya password kam se kam 6 characters." });
      return;
    }
    if (newPwd !== newPwd2) {
      setPwdMsg({ type: "err", text: "Dono passwords match nahi." });
      return;
    }
    setPwdBusy(true);
    try {
      await apiFetch("/v1/auth/account", {
        method: "PATCH",
        body: JSON.stringify({ current_password: currentPwd, password: newPwd }),
      });
      setPwdMsg({ type: "ok", text: "Password DigitalOcean pe update ho gaya." });
      setCurrentPwd("");
      setNewPwd("");
      setNewPwd2("");
    } catch (err: unknown) {
      setPwdMsg({ type: "err", text: err instanceof Error ? err.message : "Update fail." });
    } finally {
      setPwdBusy(false);
    }
  };

  const logout = async () => {
    clearLocalSession();
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-20">
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

  return (
    <>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/70 hover:text-[#f5d97a] mb-4"
      >
        <ArrowLeft className="h-3 w-3" /> Back to Dashboard
      </Link>
      <PageHeader title="My Profile" subtitle="Apna account manage kariye" />

      <GoldCard className="p-5 mb-5 flex items-center gap-4">
        <div
          className="h-14 w-14 rounded-2xl grid place-items-center shrink-0"
          style={{ background: "linear-gradient(180deg, #f5d97a, #d4af37, #8b6508)" }}
        >
          <Crown className="h-7 w-7 text-[#1a1208]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.3em] text-[#d4af37]/80 mb-0.5">{topRole}</p>
          <p className="text-base text-[#fff8dc] font-semibold truncate flex items-center gap-1.5">
            <User className="h-4 w-4 text-[#d4af37]/70" />
            {email}
          </p>
        </div>
        <GoldButton variant="danger" onClick={logout}>
          <span className="inline-flex items-center gap-1.5">
            <LogOut className="h-3.5 w-3.5" /> Logout
          </span>
        </GoldButton>
      </GoldCard>

      <div className="grid lg:grid-cols-2 gap-5">
        <GoldCard className="p-5">
          <h3 className="text-[#fff8dc] font-bold text-sm uppercase tracking-widest flex items-center gap-2 mb-4">
            <Mail className="h-4 w-4 text-[#d4af37]" /> Change Email
          </h3>
          <form onSubmit={updateEmail} className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-1.5 block">
                New Email
              </label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-[#d4af37]/30 text-[#fff8dc] outline-none focus:border-[#d4af37] text-sm"
              />
            </div>
            {emailMsg && (
              <div
                className={`rounded-xl px-3 py-2 text-xs border ${
                  emailMsg.type === "ok"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-red-500/40 bg-red-500/10 text-red-200"
                }`}
              >
                {emailMsg.text}
              </div>
            )}
            <GoldButton type="submit" disabled={emailBusy}>
              {emailBusy ? "Updating..." : "Update Email"}
            </GoldButton>
          </form>
        </GoldCard>

        <GoldCard className="p-5">
          <h3 className="text-[#fff8dc] font-bold text-sm uppercase tracking-widest flex items-center gap-2 mb-4">
            <Lock className="h-4 w-4 text-[#d4af37]" /> Change Password
          </h3>
          <form onSubmit={updatePassword} className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-1.5 block">
                Current Password
              </label>
              <input
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-[#d4af37]/30 text-[#fff8dc] outline-none focus:border-[#d4af37] text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-1.5 block">
                New Password
              </label>
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                minLength={6}
                className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-[#d4af37]/30 text-[#fff8dc] outline-none focus:border-[#d4af37] text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.25em] text-[#f5d97a]/80 font-bold mb-1.5 block">
                Confirm New Password
              </label>
              <input
                type="password"
                value={newPwd2}
                onChange={(e) => setNewPwd2(e.target.value)}
                minLength={6}
                className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-[#d4af37]/30 text-[#fff8dc] outline-none focus:border-[#d4af37] text-sm"
              />
            </div>
            {pwdMsg && (
              <div
                className={`rounded-xl px-3 py-2 text-xs border ${
                  pwdMsg.type === "ok"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-red-500/40 bg-red-500/10 text-red-200"
                }`}
              >
                {pwdMsg.text}
              </div>
            )}
            <GoldButton type="submit" disabled={pwdBusy}>
              {pwdBusy ? "Updating..." : "Update Password"}
            </GoldButton>
          </form>
        </GoldCard>
      </div>
    </>
  );
}
