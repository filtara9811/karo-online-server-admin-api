export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <p className="font-semibold">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-[11px] uppercase tracking-widest font-bold text-[#f5d97a] hover:text-[#fff8dc]"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function GoldEmpty({ children }: { children: import("react").ReactNode }) {
  return (
    <div
      className="rounded-2xl border p-12 text-center"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,253,245,0.06) 0%, rgba(255,253,245,0.02) 100%)",
        borderColor: "rgba(212,175,55,0.3)",
      }}
    >
      <p className="text-[#f5d97a]/60 text-sm">{children}</p>
    </div>
  );
}
