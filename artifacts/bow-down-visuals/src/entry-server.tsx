import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { AuthProvider } from "@/contexts/AuthContext";
import { SiteFooter } from "@/components/layout/footer";
import Home from "@/pages/home";

/**
 * Build-time prerender entry for the public marketing routes.
 *
 * This intentionally renders a *minimal* provider tree — just the bits the
 * marketing pages themselves need (react-query for data hooks, auth context,
 * and a wouter router pinned to the requested path) — rather than the full
 * `<App />` shell. The full app pulls in browser-only singletons (audio
 * playback, drag-to-position widgets, localStorage-backed artist state) that
 * only make sense once a real browser takes over. The client still boots the
 * full `<App />` via `main.tsx`, which fully replaces this prerendered markup,
 * so parity with the live app is not required here — only enough real HTML
 * for crawlers and social-preview bots to see the actual page content up
 * front.
 *
 * Access lock-down (Lane 4, audit §1.4 / §5.1): this registry is trimmed
 * to the ONE static route that stays public AND was prerendered — `/`.
 * The SEO/marketing family that used to register here (/pricing,
 * /beta-access, /tools + /tools/*, /for + /for/*, genre hubs from
 * @/data/seo-pages) is LOCKED behind sign-in by the owner's ruling, so it
 * must not be prerenderable at all: a prerendered page that bounces to
 * /login is a soft-404 risk. The pages themselves still exist in the SPA
 * (App.tsx routes them behind the guest gate) — only their build-time
 * prerender registration is gone. scripts/prerender.mjs drives the same
 * trimmed list; both are pinned by
 * src/lib/prerender-sitemap-lockdown.test.ts.
 */
const MARKETING_PAGES: Record<string, ComponentType> = {
  "/": Home,
};

export function renderMarketingPage(path: string): string {
  const Page = MARKETING_PAGES[path];
  if (!Page) {
    throw new Error(`No marketing page registered for path "${path}"`);
  }

  const queryClient = new QueryClient();

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter ssrPath={path}>
          <Page />
          <SiteFooter />
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}
