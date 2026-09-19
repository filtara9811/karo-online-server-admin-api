import { Link } from "react-router-dom";
import { Crown, ArrowLeft } from "lucide-react";

export default function ResetPasswordPage() {
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
            Password reset
          </h1>
        </div>

        <div
          className="rounded-3xl p-6 backdrop-blur-xl border space-y-3 text-center"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,253,245,0.08) 0%, rgba(255,253,245,0.04) 100%)",
            borderColor: "rgba(212,175,55,0.35)",
          }}
        >
          <p className="text-sm text-[#fff8dc]">
            Email reset DigitalOcean par available nahi hai. Login karke Profile se password change kariye.
          </p>
          <Link
            to="/login"
            className="inline-block text-xs uppercase tracking-widest text-[#f5d97a] underline"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
