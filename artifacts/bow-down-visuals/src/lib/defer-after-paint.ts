/**
 * Stack-28 #47 — defer non-critical heavy media until after first paint.
 *
 * Runs `cb` once `el` is (nearly) visible AND the browser has painted at
 * least twice (double requestAnimationFrame), so multi-MB hero media never
 * competes with the first paint. A safety timeout guarantees the callback
 * still runs if the observer never fires (headless, hidden tab), so the
 * shipped look ALWAYS arrives — only its timing changes. Returns a cancel
 * function for effect cleanup.
 */
export function deferAfterFirstPaint(el: Element | null, cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let done = false;
  let visible = !el || typeof IntersectionObserver === "undefined";
  let painted = false;

  const run = () => {
    if (cancelled || done || !visible || !painted) return;
    done = true;
    cb();
  };

  const raf1 = requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      painted = true;
      run();
    });
  });

  let observer: IntersectionObserver | null = null;
  if (el && typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          visible = true;
          run();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
  }

  const safety = window.setTimeout(() => {
    visible = true;
    painted = true;
    run();
  }, 2500);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf1);
    observer?.disconnect();
    window.clearTimeout(safety);
  };
}
