import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";

/**
 * One-click share for rendered clips (freeze-frame / mask results).
 * Uses the native share sheet where available, falls back to copying the
 * link. The share text carries the "Made with Bow Down Visuals" attribution.
 */
export function useShareClip() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const shareClip = useCallback(
    async (url: string, title: string) => {
      const text = `${title} — ${t("videoEditor.shareAttribution")}`;
      try {
        if (navigator.share) {
          await navigator.share({ title, text, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        toast({ title: t("videoEditor.linkCopiedTitle"), description: t("videoEditor.linkCopiedDesc") });
      } catch {
        /* user cancelled the share sheet */
      }
    },
    [t, toast],
  );

  return { shareClip };
}
