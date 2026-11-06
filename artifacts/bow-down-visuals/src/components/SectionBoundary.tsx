import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  SectionBoundaryCore,
  type SectionBoundaryVariant,
} from "./section-boundary";

/**
 * SectionBoundary — the hook wrapper pages import. Resolves the
 * fallback copy (sectionBoundary.* keys, defaultValue pattern as
 * elsewhere) and the active theme, then hands both to the hook-free
 * boundary class in section-boundary.ts. See that file for the
 * Stack-200 section-C contract (census items 41 + 43).
 *
 * Locale note: the sectionBoundary.* strings are NEW copy. en.json
 * carries the source; the other nine catalogs carry the English text
 * verbatim as UNREVIEWED placeholders pending real translation (the
 * locale-completeness placeholder contract) — they are NOT drafted
 * translations.
 */
export function SectionBoundary({
  name,
  variant = "section",
  label,
  fallbackClassName,
  children,
}: {
  name: string;
  variant?: SectionBoundaryVariant;
  /** Compact variant only: which honest label the fallback carries.
   *  Defaults to the generic section label. */
  label?: "post" | "composer";
  fallbackClassName?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const title =
    variant === "compact" && label === "post"
      ? t("sectionBoundary.postTitle", {
          defaultValue: "This post couldn't be shown",
        })
      : variant === "compact" && label === "composer"
        ? t("sectionBoundary.composerTitle", {
            defaultValue: "The composer hit a snag",
          })
        : t("sectionBoundary.title", {
            defaultValue: "This section hit a snag",
          });
  return (
    <SectionBoundaryCore
      name={name}
      variant={variant}
      isLight={isLight}
      title={title}
      description={t("sectionBoundary.description", {
        defaultValue:
          "Something glitched while this part of the page was loading. The rest of the page is fine — try this section again.",
      })}
      retryLabel={t("sectionBoundary.retry", { defaultValue: "Try again" })}
      fallbackClassName={fallbackClassName}
    >
      {children}
    </SectionBoundaryCore>
  );
}
