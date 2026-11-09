/**
 * Marble Splash — the shell's stone accents (owner ruling, Nov 8, 2026;
 * Gate-1 preview approved Nov 9, 2026).
 *
 * The splash is ADDED onto the existing site — a slim marble strip
 * across the very top of the app shell with a 1px gold hairline under
 * it, and a matching slim strip at the foot of the shell. Nothing else
 * changes: no page composition, no marble walls or grounds, no
 * per-card frames. The stone itself is themed in index.css (the
 * .marble-strip rules): calm black marble in dark theme, golden cream
 * marble in light, swapped by the same .light class that drives every
 * other surface.
 *
 * Mounted by AppShell (App.tsx) — the top strip is the shell's first
 * in-flow element, the foot strip closes the shell right after
 * SiteFooter — and mirrored by the build-time prerender shell
 * (entry-server.tsx) so crawlers see the same frame. Stream overlays
 * (/overlay/*) render with NO shell at all and never see these.
 */
export function MarbleTopStrip() {
  return (
    <div
      aria-hidden="true"
      data-testid="marble-strip-top"
      className="marble-strip marble-strip-top"
    />
  );
}

export function MarbleFootStrip() {
  return (
    <div
      aria-hidden="true"
      data-testid="marble-strip-foot"
      className="marble-strip marble-strip-foot"
    />
  );
}
