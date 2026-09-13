import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, Loader2, ShieldCheck, Search, RefreshCw } from "lucide-react";
import { apiFetch, asList, bool, str } from "@/lib/api";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { GoldButton, GoldCard, PageHeader } from "@/components/admin/AdminLayout";

export default function StaffPage() {
  const [q, setQ] = useState("");
  const staffQ = useQuery({
    queryKey: ["admin-staff"],
    queryFn: async () => asList(await apiFetch("/v1/admin/staff")),
  });
  const rolesQ = useQuery({
    queryKey: ["admin-table", "user_roles"],
    queryFn: async () => asList(await apiFetch("/v1/admin/table/user_roles")),
  });

  const staff = staffQ.data ?? [];
  const roles = rolesQ.data ?? [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return staff;
    return staff.filter((r) =>
      [r.name, r.email, r.phone, r.designation, r.department]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(s)),
    );
  }, [staff, q]);

  const grouped = useMemo(() => {
    const map: Record<string, Record<string, unknown>[]> = {};
    roles.forEach((r) => {
      const uid = str(r.user_id);
      if (!uid) return;
      map[uid] = map[uid] ?? [];
      map[uid].push(r);
    });
    return map;
  }, [roles]);

  const err = staffQ.error || rolesQ.error;

  return (
    <>
      <PageHeader
        title="Staff & Roles"
        subtitle="Admin users ko role assign kariye"
        action={
          <GoldButton variant="outline" onClick={() => { staffQ.refetch(); rolesQ.refetch(); }}>
            <RefreshCw className="h-3.5 w-3.5 inline mr-1.5" /> Refresh
          </GoldButton>
        }
      />

      {err && (
        <div className="mb-4">
          <ErrorBanner
            message={err instanceof Error ? err.message : "Staff load fail"}
            onRetry={() => {
              staffQ.refetch();
              rolesQ.refetch();
            }}
          />
        </div>
      )}

      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.25em] text-[#d4af37]/70 font-bold mb-2">
          Staff Members ({staff.length})
        </p>
        <GoldCard className="p-3 mb-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#d4af37]/70" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search staff…"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-black/30 border border-[#d4af37]/30 text-[#f5d97a] placeholder:text-[#f5d97a]/40 focus:outline-none focus:border-[#d4af37]"
            />
          </div>
        </GoldCard>
        {staffQ.isLoading ? (
          <GoldCard className="p-8 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-[#d4af37] mx-auto" />
          </GoldCard>
        ) : filtered.length === 0 ? (
          <GoldCard className="p-8 text-center">
            <p className="text-xs text-[#f5d97a]/60">
              {staff.length === 0 ? "Abhi koi staff member registered nahi hai." : "No matches"}
            </p>
          </GoldCard>
        ) : (
          <div className="space-y-2">
            {filtered.map((s) => (
              <GoldCard key={str(s.id)} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full overflow-hidden border border-[#d4af37]/40 bg-gradient-to-br from-[#fff8dc] to-[#d4af37] grid place-items-center flex-shrink-0">
                    <span className="font-bold text-[#1a1a1a] text-sm">
                      {str(s.name || s.email || "?", "?").charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="text-sm font-bold text-[#fff8dc] truncate">{str(s.name, "Unnamed")}</h4>
                      {bool(s.verified) && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                          <ShieldCheck className="h-2 w-2" /> VERIFIED
                        </span>
                      )}
                      {bool(s.is_blocked) && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30">
                          BLOCKED
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#f5d97a]/70 truncate">
                      {[s.designation, s.department].filter(Boolean).join(" · ") || str(s.email, "—")}
                    </p>
                  </div>
                </div>
              </GoldCard>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] uppercase tracking-[0.25em] text-[#d4af37]/70 font-bold mb-2">
        Role Assignments
      </p>
      <GoldCard className="p-3 sm:p-4">
        {rolesQ.isLoading ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-16">
            <Shield className="h-10 w-10 text-[#d4af37]/40 mx-auto mb-3" />
            <p className="text-sm text-[#f5d97a]/60">Abhi koi staff member nahi hai.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#d4af37]/10">
            {Object.entries(grouped).map(([uid, userRoles]) => (
              <div key={uid} className="py-3 px-2 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#d4af37]/60 mb-1">User ID</p>
                  <p className="text-xs text-[#fff8dc] font-mono truncate">{uid}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {userRoles.map((r) => (
                    <span
                      key={str(r.id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-[#1a1208]"
                      style={{
                        background: "linear-gradient(180deg, #fff8dc, #f5d97a, #d4af37)",
                      }}
                    >
                      {str(r.role).replace("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </GoldCard>

      <GoldCard className="mt-4 p-4">
        <p className="text-[10px] uppercase tracking-[0.25em] text-[#d4af37]/70 font-bold mb-2">💡 Tip</p>
        <p className="text-xs text-[#f5d97a]/70 leading-relaxed">
          Staff member pehle <code className="text-[#d4af37]">/login</code> page se "Request Access" se
          signup karein. Phir unka User ID aapko email confirmation ya database se mil jayega — yahan
          paste karke role assign kar dijiye.
        </p>
      </GoldCard>
    </>
  );
}
