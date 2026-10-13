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

    return () => {
      document.title = SITE_SUFFIX;
    };
  }, [title, description]);
}
