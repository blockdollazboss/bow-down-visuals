import { useState } from "react";
import { Download, X } from "lucide-react";
import { usePwaInstall } from "@/lib/extension-promo";
import { isPromptDismissed, recordPromptDismissal } from "@/lib/prompt-dismissal";

/* PWA install prompt — rides the ONE shared install state
   (lib/extension-promo's usePwaInstall). The module-level capture owns
   the deferred beforeinstallprompt, so this card can never hold a
   spent copy of the event: a deferred prompt can only be prompted
   once, and when another surface (the /app page) got there first, a
   private copy's prompt() rejects — the old card leaked that as an
   unhandled rejection and stayed on screen with a dead Install
   button. Now any prompt attempt resolves through the shared hook,
   the shared state clears, and the card goes with it.
   Dismissal is remembered in localStorage for 30 days, then the
   card may ask again (owner ruling, stack1400 #16 — the shared
   timestamped memory in lib/prompt-dismissal, under this card's
   standing key). A legacy bare "1" from the permanent-dismissal
   era migrates to a fresh 30 days at first read. */
export function PWAInstallPrompt() {
  const { canInstall, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState<boolean>(() =>
    isPromptDismissed("bdv-pwa-dismissed"),
  );

  if (!canInstall || dismissed) return null;

  const install = async () => {
    await promptInstall();
  };

  const dismiss = () => {
    setDismissed(true);
    recordPromptDismissal("bdv-pwa-dismissed");
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-[9000]">
      <div className="bg-card border border-primary/30 rounded-2xl p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
            <Download className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-sm">Install Bow Down Visuals</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add to your home screen for quick access
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={install}
                className="px-4 py-1.5 rounded-lg bg-primary text-black text-sm font-bold hover:brightness-110"
              >
                Install
              </button>
              <button
                onClick={dismiss}
                className="px-4 py-1.5 rounded-lg border border-white/10 text-sm hover:bg-white/5"
              >
                Later
              </button>
            </div>
          </div>
          <button aria-label="Dismiss" onClick={dismiss} className="p-1 hover:bg-white/5 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
