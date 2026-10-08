import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
import { MOVED_PAGES } from "@/lib/moved-pages";

/**
 * One-time wayfinding banner for merged pages.
 *
 * Mount once near the top of the app shell. When the URL carries
 * `?moved_from=<slug>` (set by old-route redirects), shows e.g.
 * "Thumbnail Maker has a new home — find it in the Thumbnail Studio,
 * under Generate." Auto-dismisses after 6 seconds or on click.
 * Session-gated: once per slug per session. In-flow strip, never blocking,
 * renders nothing when there is no (known) moved_from param.
 */
export function MovedBanner() {
  const { t } = useTranslation();
  const search = useSearch();
  const [visible, setVisible] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);

  useEffect(() => {
    let next: string | null = null;
    try {
      next = new URLSearchParams(search).get("moved_from");
    } catch {
      next = null;
    }
    if (!next || !MOVED_PAGES[next]) {
      setVisible(false);
      setSlug(null);
      return;
    }
    try {
      if (sessionStorage.getItem(`bdv-moved-seen:${next}`)) {
        setVisible(false);
        setSlug(null);
        return;
      }
    } catch {
      /* storage unavailable — show once per arrival */
    }
    setSlug(next);
    setVisible(true);
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(`bdv-moved-seen:${next}`, "1");
      } catch {
        /* ignore */
      }
      setVisible(false);
    }, 6000);
    return () => clearTimeout(timer);
  }, [search]);

  const dismiss = () => {
    try {
      if (slug) sessionStorage.setItem(`bdv-moved-seen:${slug}`, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible || !slug || !MOVED_PAGES[slug]) return null;
  const info = MOVED_PAGES[slug];

  return (
    <div
      role="status"
      onClick={dismiss}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "12px auto 0",
        maxWidth: 1100,
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid rgba(201,168,76,0.45)",
        background: "linear-gradient(135deg, rgba(201,168,76,0.14), rgba(201,168,76,0.04))",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#C9A84C",
          boxShadow: "0 0 8px rgba(201,168,76,0.9)",
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", flex: 1 }}>
        {t("movedPages.banner", {
          name: t(info.nameKey),
          location: t(info.locationKey),
        })}
      </span>
      <button
        type="button"
        aria-label={t("movedPages.dismiss")}
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
        style={{
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.5)",
          fontSize: 18,
          lineHeight: 1,
          cursor: "pointer",
          padding: "2px 6px",
        }}
      >
        ×
      </button>
    </div>
  );
}
