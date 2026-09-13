import { useEffect, useState, type CSSProperties } from "react";

export function AnimatedNumber({
  value,
  className,
  style,
  digits = 0,
}: {
  value: number;
  className?: string;
  style?: CSSProperties;
  digits?: number;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const target = Number(value) || 0;
    const start = shown;
    const t0 = performance.now();
    const dur = 500;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(start + (target - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className={className} style={style}>
      {shown.toFixed(digits)}
    </span>
  );
}
