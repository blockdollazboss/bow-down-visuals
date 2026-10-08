import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import { AuthProvider } from "@/contexts/AuthContext";
import { SiteFooter } from "@/components/layout/footer";
import Home from "@/pages/home";
import Pricing from "@/pages/pricing";
import Waitlist from "@/pages/waitlist";
/* SEO programmatic pages (Worker 9): tool pages, vertical hubs, genre hubs.
   These are pure static markup (no auth, no i18n, no data fetching), so they
   render fully in this minimal tree — crawlers get real HTML + JSON-LD. */
import ToolsIndex from "@/pages/seo/tools-index";
import ForIndex from "@/pages/seo/for-index";
import { ToolPageBySlug } from "@/pages/seo/tool-page";
import { VerticalHubBySlug } from "@/pages/seo/vertical-hub";
import { GenreHubBySlug } from "@/pages/seo/genre-hub";
import { TOOL_PAGES, VERTICAL_HUBS, GENRE_HUBS } from "@/data/seo-pages";

/**
 * Build-time prerender entry for the public marketing routes.
 *
 * This intentionally renders a *minimal* provider tree — just the bits the
 * marketing pages themselves need (react-query for data hooks, auth context
 * for the pricing page's CTA copy, and a wouter router pinned to the
 * requested path) — rather than the full `<App />` shell. The full app
 * pulls in browser-only singletons (audio playback, drag-to-position
 * widgets, localStorage-backed artist state) that only make sense once a
 * real browser takes over. The client still boots the full `<App />` via
 * `main.tsx`, which fully replaces this prerendered markup, so parity with
 * the live app is not required here — only enough real HTML for crawlers
 * and social-preview bots to see the actual page content up front.
 */
const MARKETING_PAGES: Record<string, ComponentType> = {
  "/": Home,
  "/pricing": Pricing,
  "/waitlist": Waitlist,
  "/tools": ToolsIndex,
  "/for": ForIndex,
  ...Object.fromEntries(
    TOOL_PAGES.map((t) => [
      t.path,
      (() => {
        const slug = t.slug;
        return function ToolRoute() {
          return <ToolPageBySlug slug={slug} />;
        };
      })(),
    ]),
  ),
  ...Object.fromEntries(
    VERTICAL_HUBS.map((v) => [
      v.path,
      (() => {
        const slug = v.slug;
        return function VerticalRoute() {
          return <VerticalHubBySlug slug={slug} />;
        };
      })(),
    ]),
  ),
  ...Object.fromEntries(
    GENRE_HUBS.map((g) => [
      g.path,
      (() => {
        const slug = g.slug;
        return function GenreRoute() {
          return <GenreHubBySlug slug={slug} />;
        };
      })(),
    ]),
  ),
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
