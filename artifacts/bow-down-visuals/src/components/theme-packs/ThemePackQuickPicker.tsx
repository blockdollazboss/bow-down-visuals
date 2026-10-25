import { useEffect, useState } from "react";
import { Check, Lock, Palette, X } from "lucide-react";
import {
  THEME_PACKS,
  THEME_PACK_EVENT,
  THEME_PACK_PRICE_VB,
  applyThemePack,
  getActiveThemePack,
  getThemeMode,
  hslCss,
  isThemePackUnlocked,
} from "@/lib/theme-packs";
import { useAuth } from "@/contexts/AuthContext";
import { stampPackSoundsForApply } from "@/lib/theme-kit";

/* ─── Theme packs at the theme toggle (Stack-200 FIX 14) ──────────────
   The packs used to live ONLY at the bottom of Settings. This picker
   hangs them on the appearance point of choice — the floating theme
   toggle — so a pack is one tap from every page: unlocked packs apply
   in place (mode + paired cursor + synced library sounds follow the
   desk's apply path); locked premium packs route to the desk in
   Settings where the purchase rail lives. The Settings desk stays
   the full home (downloads, customization, creator packs). */

export function ThemePackQuickPicker() {
  const { getAccessToken, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>(() => getActiveThemePack().id);
  const [ownedIds, setOwnedIds] = useState<readonly string[]>([]);
  const [elite, setElite] = useState(false);

  useEffect(() => {
    const sync = () => setActiveId(getActiveThemePack().id);
    window.addEventListener(THEME_PACK_EVENT, sync);
    return () => window.removeEventListener(THEME_PACK_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/theme-packs/state", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { owned?: string[]; elite?: boolean };
        setOwnedIds(json.owned ?? []);
        setElite(json.elite === true);
      } catch { /* picker still lists packs; premium stays locked-looking */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  const mode = getThemeMode();

  return (
    <div className="fixed left-[128px] top-4 z-[9999]" data-testid="theme-pack-quick-picker">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Theme packs"
        aria-expanded={open}
        title="Theme packs — whole-device kits"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/30 bg-black/60 text-primary shadow-lg backdrop-blur-md transition hover:scale-105 hover:bg-black/80 light:bg-white/80 light:text-[#7A5A12]"
      >
        {open ? <X className="h-5 w-5" /> : <Palette className="h-5 w-5" />}
      </button>
      {open ? (
        <div className="mt-2 w-72 rounded-2xl border border-border bg-card p-3 shadow-xl" role="dialog" aria-label="Theme packs">
          <p className="text-xs font-bold text-foreground" style={{ fontFamily: "Cinzel, serif" }}>
            Theme Packs
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground" style={{ fontFamily: "Manrope, sans-serif" }}>
            Whole-device kits — site, phone, tablet and computer. Sounds sync from the
            sound library with every pack.
          </p>
          <ul className="mt-2 space-y-1.5">
            {THEME_PACKS.map((pack) => {
              const unlocked = isThemePackUnlocked(pack, ownedIds, elite);
              const variant = pack.variants[mode] ?? pack.variants.dark ?? pack.variants.light!;
              const active = pack.id === activeId;
              return (
                <li key={pack.id}>
                  <button
                    type="button"
                    data-testid={`quick-pack-${pack.id}`}
                    disabled={!unlocked}
                    onClick={() => {
                      applyThemePack(pack.id);
                      /* Same sound stamp as the desk's apply: local seam
                         + the pack's roles into the account's
                         sound_prefs (join #12 binding). The button is
                         disabled for locked packs; the stamper re-checks
                         the entitlement it is handed. */
                      void stampPackSoundsForApply(pack.id, {
                        unlocked,
                        getAccessToken,
                      });
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl border border-border px-2.5 py-2 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span className="flex shrink-0 -space-x-1" aria-hidden="true">
                      {pack.swatches.map((hex) => (
                        <span key={hex} className="block h-4 w-4 rounded-full border border-black/20" style={{ backgroundColor: hex }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">{pack.name}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {pack.tier === "premium" && !unlocked
                          ? `${THEME_PACK_PRICE_VB.toLocaleString()} VB — own it forever`
                          : `Accent ${hslCss(variant.tokens.primary)} · pairs with its cursor + library sounds`}
                      </span>
                    </span>
                    {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : !unlocked ? <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <a
            href="/settings#theme-packs"
            className="mt-2 block rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-center text-xs font-semibold text-primary"
            data-testid="quick-pack-open-desk"
          >
            Open the full kit desk — downloads, customization, creator packs
          </a>
        </div>
      ) : null}
    </div>
  );
}
