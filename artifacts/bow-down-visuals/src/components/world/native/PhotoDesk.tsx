/**
 * PhotoDesk — the Photo Studio family's native desk in the
 * Create Wing (Stack 400 world parity, census Lane B item
 * B-04), dispatched by CreateDeskPanel for the photo-desk
 * station. One shared intake (the family's own free upload
 * door) feeds six benches, each the in-World form of a 2D
 * Photo Studio rail: BgStudio's background removal + AI
 * backdrop, the editor's background-plate rail, PhotoEnhance,
 * the Headshot Studio and the Product Photo Studio — every
 * charged run on the registry-priced spend confirmation, on
 * the family's own rails (lib/world/photo-desk.ts).
 */
import { useState } from "react";
import { Camera, Eraser, ImagePlus, Sparkles, User, Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PanelBoundary } from "@/components/world/panel-boundary";
import type { CreateDeskProps } from "./CreateDesks";
import {
  BgPlateBench,
  HeadshotBench,
  PhotoBackdropBench,
  PhotoEnhanceBench,
  PhotoIntake,
  ProductPhotoBench,
  RemoveBackgroundBench,
  type DeskPhoto,
} from "./PhotoBenches";

type PhotoBenchId = "remove" | "backdrop" | "plate" | "enhance" | "headshot" | "product";

export function PhotoDesk(props: CreateDeskProps) {
  const { isLight } = props;
  const { t } = useTranslation();
  const [photo, setPhoto] = useState<DeskPhoto | null>(null);
  const [bench, setBench] = useState<PhotoBenchId>("remove");
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  const tabs: Array<{ id: PhotoBenchId; icon: typeof Camera; label: string }> = [
    { id: "remove", icon: Eraser, label: t("bgStudio.removeCta") },
    { id: "backdrop", icon: Sparkles, label: t("bgStudio.kind.ai") },
    { id: "plate", icon: Wand2, label: t("worldPhotoDesk.plateTitle", { defaultValue: "Background plates" }) },
    { id: "enhance", icon: Sparkles, label: t("photoEnhance.featureName") },
    { id: "headshot", icon: User, label: t("headshotStudio.title") },
    { id: "product", icon: Camera, label: t("productPhotoStudio.title") },
  ];

  return (
    <div className="space-y-4" data-testid="world-photo-desk">
      <div>
        <p className={`flex items-center gap-2 text-lg font-black ${strong}`}>
          <ImagePlus className={`h-5 w-5 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
          {t("worldPhotoDesk.title", { defaultValue: "Photo Desk" })}
        </p>
        <p className={`mt-1 text-xs ${muted}`}>
          {t("worldPhotoDesk.subtitle", {
            defaultValue:
              "The Photo Studio, in-world — cutouts, backdrops, plates, enhancement, headshots and product shots, each on the studio's own rail at its own price.",
          })}
        </p>
      </div>

      <PanelBoundary isLight={isLight} resetKey="photo-desk-intake">
        <PhotoIntake isLight={isLight} photo={photo} onPhoto={setPhoto} />
      </PanelBoundary>

      <div className="flex flex-wrap gap-1.5" data-testid="world-photo-desk-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`world-photo-desk-tab-${tab.id}`}
            aria-pressed={bench === tab.id}
            onClick={() => setBench(tab.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
              bench === tab.id
                ? "border-[#d4af37] bg-[#d4af37] text-black"
                : isLight
                  ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                  : "border-white/15 text-white/75 hover:text-white"
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <PanelBoundary isLight={isLight} resetKey={`photo-desk-${bench}`}>
        {bench === "remove" ? <RemoveBackgroundBench isLight={isLight} photo={photo} /> : null}
        {bench === "backdrop" ? <PhotoBackdropBench isLight={isLight} photo={photo} /> : null}
        {bench === "plate" ? <BgPlateBench isLight={isLight} /> : null}
        {bench === "enhance" ? <PhotoEnhanceBench isLight={isLight} photo={photo} /> : null}
        {bench === "headshot" ? <HeadshotBench isLight={isLight} photo={photo} /> : null}
        {bench === "product" ? (
          <ProductPhotoBench isLight={isLight} photo={photo} onUsePhoto={(url) => setPhoto({ url, dims: null })} />
        ) : null}
      </PanelBoundary>
    </div>
  );
}
