import { useEffect, useState } from "react";
import { X, Puzzle } from "lucide-react";
import { Link } from "wouter";
import { useExtensionPromoVisible } from "@/lib/extension-promo";

/* Floating badge on the login/signup screens promoting the Chrome extension.
   Mirrors the SpotlightPromo pattern: session-dismissible, and permanently
   hidden once the visitor has downloaded the extension. */

const DISMISS_KEY = "extension-badge-dismissed";

export default function ExtensionPromoBadge() {
  const promoVisible = useExtensionPromoVisible();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch { /* private mode */ }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
  };

  if (!promoVisible || dismissed) return null;

  return (
    <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-full border border-[#c9a84c]/50 bg-black/55 backdrop-blur-md px-4 py-2 text-sm font-medium text-[#e8c86a] shadow-[0_0_18px_rgba(201,168,76,0.25)] transition hover:bg-black/75">
      <Puzzle className="h-4 w-4" />
      <Link href="/extension" className="hover:underline">
        Get the Chrome extension
      </Link>
      <span
        role="button"
        tabIndex={0}
        aria-label="Dismiss"
        className="ml-1 rounded-full p-0.5 text-white/40 hover:text-white cursor-pointer"
        onClick={(e) => { e.stopPropagation(); dismiss(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); dismiss(); } }}
      >
        <X className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}
