import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { SettingsCardBoundaryCore } from "./settings-card-boundary";

/**
 * SettingsCardBoundary — the hook wrapper the Settings page imports.
 * Resolves the fallback copy (settings.cardError* keys, defaultValue
 * pattern as elsewhere on the page) and the active theme, then hands
 * both to the hook-free boundary class in settings-card-boundary.ts.
 * See that file for the QC-200 G4 contract.
 */
export function SettingsCardBoundary({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  return (
    <SettingsCardBoundaryCore
      name={name}
      isLight={isLight}
      title={t("settings.cardErrorTitle", {
        defaultValue: "This section hit a snag",
      })}
      description={t("settings.cardErrorDescription", {
        defaultValue:
          "Something glitched while this part of Settings was loading. The rest of your settings are fine — try this section again.",
      })}
      retryLabel={t("settings.cardErrorRetry", { defaultValue: "Try again" })}
    >
      {children}
    </SettingsCardBoundaryCore>
  );
}
