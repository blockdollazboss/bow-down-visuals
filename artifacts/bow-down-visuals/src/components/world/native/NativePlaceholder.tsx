import { Hammer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PalaceStation } from "@/lib/world/stations";
import { NativeCard } from "./NativeCard";

/* ─── NativePlaceholder — the honest migration card (§3.0) ───────────
   What a native station shows until its pattern surface ships:
   the desk is being rebuilt FOR the palace — said plainly, in
   palace language, never a silent pull-up of the website page and
   never a dead end. The panel host frames this card with the
   standard transfer footer (TransferFooter), so the full desk is
   always one explicit click away on the website. Pattern lanes
   replace this card with the real instrument; the footer stays. */

export interface NativePlaceholderProps {
  station: PalaceStation;
  isLight: boolean;
}

export function NativePlaceholder({ station, isLight }: NativePlaceholderProps) {
  const { t } = useTranslation();
  return (
    <NativeCard isLight={isLight}>
      <div
        data-testid="world-native-placeholder"
        className="flex flex-col items-center gap-3 px-2 py-6 text-center"
      >
        <Hammer className="h-7 w-7 text-[#d4af37]" />
        <p
          className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}
        >
          {t("worldPrimitives.phTitle")}
        </p>
        <p className={`max-w-sm text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          {t("worldPrimitives.phBody", { name: station.name })}
        </p>
      </div>
    </NativeCard>
  );
}
