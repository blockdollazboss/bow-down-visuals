import { useEffect } from "react";

/**
 * usePageTitle — sets document.title (and the meta description) for the
 * current page. Every route should call this so tabs, history, and search
 * results show a real page name instead of the generic site title.
 *
 * Titles follow the pattern: "Page Name | Bow Down Visuals"
 *
 * It also points the canonical link at the current path. index.html ships
 * a single static canonical (the homepage), and the prerendered SEO pages
 * get theirs rewritten at build time — but a client-side navigation never
 * updated it, so every SPA page kept declaring the homepage (or the entry
 * page) as its canonical URL and search engines consolidated them there.
 */
const SITE_SUFFIX = "Bow Down Visuals";
const SITE_ORIGIN = "https://bowdownvisuals.com";

export function usePageTitle(title: string, description?: string) {
  useEffect(() => {
    const full = title ? `${title} | ${SITE_SUFFIX}` : SITE_SUFFIX;
    document.title = full;

    if (description) {
      let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (!tag) {
        tag = document.createElement("meta");
        tag.name = "description";
        document.head.appendChild(tag);
      }
      tag.content = description;
    }

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `${SITE_ORIGIN}${window.location.pathname}`;

    // Keep share previews in step with the page: without this, every
    // client-side route keeps the homepage's og/twitter tags, so shared
    // links preview as the homepage no matter which page was shared.
    const upsertMeta = (selector: string, attrs: Record<string, string>, content: string) => {
      let tag = document.querySelector<HTMLMetaElement>(selector);
      if (!tag) {
        tag = document.createElement("meta");
        for (const [k, v] of Object.entries(attrs)) tag.setAttribute(k, v);
        document.head.appendChild(tag);
      }
      tag.content = content;
    };
    upsertMeta('meta[property="og:title"]', { property: "og:title" }, full);
    upsertMeta('meta[property="og:url"]', { property: "og:url" }, `${SITE_ORIGIN}${window.location.pathname}`);
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title" }, full);
    if (description) {
      upsertMeta('meta[property="og:description"]', { property: "og:description" }, description);
      upsertMeta('meta[name="twitter:description"]', { name: "twitter:description" }, description);
    }

    return () => {
      document.title = SITE_SUFFIX;
    };
  }, [title, description]);
}
