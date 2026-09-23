import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * LuxReveal — soft scroll-triggered reveal for marketing surfaces.
 * Fades up with a whisper of blur, once, then stays. Respects
 * prefers-reduced-motion via CSS (content is always visible there).
 */
interface LuxRevealProps {
  children: ReactNode;
  className?: string;
  /** stagger delay in ms */
  delay?: number;
}

export function LuxReveal({ children, className = "", delay = 0 }: LuxRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`lux-reveal${visible ? " is-visible" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--lux-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
