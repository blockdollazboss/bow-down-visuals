import { useEffect } from "react";

/**
 * usePageTitle — sets document.title (and the meta description) for the
 * current page. Every route should call this so tabs, history, and search
 * results show a real page name instead of the generic site title.
 *
 * Titles follow the pattern: "Page Name | Bow Down Visuals"
 */
const SITE_SUFFIX = "Bow Down Visuals";

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

    return () => {
      document.title = SITE_SUFFIX;
    };
  }, [title, description]);
}
