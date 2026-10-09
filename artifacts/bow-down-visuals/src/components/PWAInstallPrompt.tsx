import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/* PWA install prompt - shows when the browser fires beforeinstallprompt */
export function PWAInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("bdv-pwa-dismissed")) {
      setDismissed(true);
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferred || dismissed) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") {
      setDeferred(null);
    }
  };

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem("bdv-pwa-dismissed", "1");
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
          <button onClick={dismiss} className="p-1 hover:bg-white/5 rounded">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
