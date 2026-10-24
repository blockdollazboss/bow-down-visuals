import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  Loader2,
  Lock,
  Moon,
  MousePointer2,
  Palette,
  RotateCcw,
  Sun,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CURSOR_OPTIONS } from "@/lib/cursor-settings";
import { useAuth } from "@/contexts/AuthContext";
import {
  HOUSE_PACK_FOR_MODE,
  THEME_PACKS,
  THEME_PACK_EVENT,
  applyThemePack,
  getActiveThemePack,
  getThemeMode,
  hslCss,
  isThemePackUnlocked,
  packModes,
  resolvePackMode,
  type ThemePack,
  type ThemePackMode,
  type ThemePackVariant,
} from "@/lib/theme-packs";
import { WALLPAPER_PRESETS, type WallpaperPreset } from "@/lib/wallpapers";

/* ─── Theme Packs desk (Settings → Appearance) ──────────────────────────
   One tap on a pack reskins the whole site — page ground, panels,
   accents, buttons, ink, scrollbars, selection — on phone and desktop
   alike, and pairs the pack's cursor. EVERY pack ships a designed
   light AND dark variant: each card carries a Light | Dark toggle that
   drives the preview, the apply (applying in Light lands the site in
   that pack's light world), and the device downloads. The desk also
   delivers the pack to the visitor's ACTUAL devices through the
   wallpaper desk's rails: the pack's ground artwork is rendered at
   every device preset (branded renders are free; the full logo lockup
   rides whole on every piece) and zipped per device kind. Premium
   packs are visible but locked: the selling model is an open owner
   decision, so nothing here carries a price or a charge — locked
   means locked (see lib/theme-packs.ts). The video editor keeps its
   own look under every pack, and the desk copy says so. */

const DEVICE_KINDS: Array<{ kind: WallpaperPreset["kind"]; label: string }> = [
  { kind: "phone", label: "Phone set" },
  { kind: "tablet", label: "Tablet set" },
  { kind: "desktop", label: "Desktop set" },
];

/** Site-relative asset → absolute URL (the render rail validates http(s)). */
function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

/** Miniature phone + desktop frames painted with a variant's REAL
    tokens (inline styles from the pack definition), so what you see
    is the world you get. */
function PackPreview({ variant, mode }: { variant: ThemePackVariant; mode: ThemePackMode }) {
  const tk = variant.tokens;
  const ex = variant.extras;
  const ground = {
    backgroundColor: hslCss(tk.background),
    backgroundImage: `radial-gradient(ellipse 90% 55% at 50% -10%, ${hslCss(ex.glowA, 0.28)}, transparent 60%), radial-gradient(ellipse 65% 45% at 85% 15%, ${hslCss(ex.glowB, 0.18)}, transparent 55%)`,
  };
  const bar = (color: string, width: string, opacity = 1) => (
    <div
      className="rounded-full"
      style={{ backgroundColor: color, width, height: 3, opacity }}
    />
  );
  return (
    <div className="flex items-end gap-3" aria-hidden="true">
      {/* phone */}
      <div
        className="w-[68px] shrink-0 overflow-hidden rounded-[12px] border shadow-sm"
        style={{ borderColor: hslCss(tk.cardBorder), ...ground }}
      >
        <div className="flex items-center justify-between px-2 pt-1.5">
          <span className="block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hslCss(tk.primary) }} />
          <span className="block h-1 w-6 rounded-full" style={{ backgroundColor: hslCss(tk.foreground, 0.25) }} />
        </div>
        <div className="space-y-1.5 px-2 py-2">
          {bar(hslCss(tk.foreground), "70%")}
          {bar(hslCss(tk.mutedForeground), "90%", 0.8)}
          <div
            className="space-y-1 rounded-md border p-1.5"
            style={{ backgroundColor: hslCss(tk.card), borderColor: hslCss(tk.border) }}
          >
            {bar(hslCss(tk.cardForeground), "60%")}
            {bar(hslCss(tk.mutedForeground), "80%", 0.75)}
          </div>
          <div
            className="flex h-4 items-center justify-center rounded-md"
            style={{ backgroundColor: hslCss(tk.primary) }}
          >
            <span className="block h-1 w-6 rounded-full" style={{ backgroundColor: hslCss(tk.primaryForeground, 0.9) }} />
          </div>
        </div>
      </div>
      {/* desktop */}
      <div
        className="w-[148px] shrink-0 overflow-hidden rounded-lg border shadow-sm"
        style={{ borderColor: hslCss(tk.cardBorder), ...ground }}
      >
        <div className="flex">
          <div
            className="flex w-8 shrink-0 flex-col gap-1.5 px-1.5 py-2"
            style={{ backgroundColor: hslCss(tk.sidebar) }}
          >
            <span className="block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hslCss(tk.sidebarPrimary) }} />
            {bar(hslCss(tk.sidebarForeground), "100%", 0.75)}
            {bar(hslCss(tk.sidebarForeground), "100%", 0.5)}
            {bar(hslCss(tk.sidebarForeground), "100%", 0.5)}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5 px-2 py-2">
            {bar(hslCss(tk.foreground), "55%")}
            {bar(hslCss(tk.mutedForeground), "85%", 0.8)}
            <div className="flex gap-1.5">
              <div
                className="flex-1 space-y-1 rounded-md border p-1.5"
                style={{ backgroundColor: hslCss(tk.card), borderColor: hslCss(tk.border) }}
              >
                {bar(hslCss(tk.cardForeground), "70%")}
                {bar(hslCss(tk.mutedForeground), "85%", 0.75)}
              </div>
              <div
                className="flex w-9 items-start justify-center rounded-md pt-1.5"
                style={{ backgroundColor: hslCss(tk.primary) }}
              >
                <span className="block h-1 w-4 rounded-full" style={{ backgroundColor: hslCss(tk.primaryForeground, 0.9) }} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">{mode === "light" ? "Light" : "Dark"} preview</span>
    </div>
  );
}

/** The per-pack device delivery: render the pack's ground for the
    chosen mode through the wallpaper rails and hand back downloads —
    a zip per device kind, or a single size on its own. */
function PackDeviceDownloads({
  pack,
  mode,
  unlocked,
}: {
  pack: ThemePack;
  mode: ThemePackMode;
  unlocked: boolean;
}) {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sizeKey, setSizeKey] = useState<string>(WALLPAPER_PRESETS[0]!.key);

  const fail = (err: unknown) => {
    setError(
      err instanceof Error && err.message === "signin"
        ? t("settings.themePacksDeviceSignin", { defaultValue: "Sign in to download device packs." })
        : t("settings.themePacksDeviceError", { defaultValue: "That download hit a snag — try again in a moment." }),
    );
  };

  /** One branded render through the wallpaper rail (free; the rail
      composites the full logo lockup whole, bottom-center). */
  const renderPiece = async (presetKey: string, token: string): Promise<string> => {
    const res = await fetch("/api/wallpapers/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sourceUrl: absoluteUrl(pack.deviceArt[mode]),
        presetKey,
        logoUrl: absoluteUrl(mode === "dark" ? "/logo-static.webp" : "/logo-light.webp"),
        branded: true,
        brandName: null,
      }),
    });
    if (!res.ok) throw new Error(`render failed (${res.status})`);
    const json = (await res.json()) as { url?: string };
    if (!json.url) throw new Error("render returned no url");
    return json.url;
  };

  const downloadSet = async (kind: WallpaperPreset["kind"]) => {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("signin");
      const urls: string[] = [];
      for (const preset of WALLPAPER_PRESETS.filter((p) => p.kind === kind)) {
        urls.push(await renderPiece(preset.key, token));
      }
      const name = `${pack.id}-${mode}-${kind}`;
      const zipRes = await fetch("/api/wallpapers/pack-download", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ urls, name }),
      });
      if (!zipRes.ok) throw new Error(`zip failed (${zipRes.status})`);
      const blob = await zipRes.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${name}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setDone(kind);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const downloadOne = async () => {
    setBusy("one");
    setError(null);
    setDone(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("signin");
      const url = await renderPiece(sizeKey, token);
      window.open(url, "_blank", "noopener");
      setDone("one");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-t border-border/60 pt-3">
      <p className="text-[11px] font-semibold text-foreground">
        {t("settings.themePacksDeviceTitle", {
          defaultValue: "On your devices — {{mode}}",
          mode:
            mode === "light"
              ? t("settings.themePacksLight", { defaultValue: "Light" })
              : t("settings.themePacksDark", { defaultValue: "Dark" }),
        })}
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
        {t("settings.themePacksDeviceLine", {
          defaultValue:
            "Every size for your phone, tablet and computer — free, with the full Bow Down Visuals logo riding whole on each piece.",
        })}
      </p>
      {unlocked ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DEVICE_KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                data-testid={`theme-pack-device-${kind}-${pack.id}`}
                disabled={busy !== null}
                onClick={() => void downloadSet(kind)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium transition hover:bg-accent disabled:opacity-60"
              >
                {busy === kind ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : done === kind ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            <select
              data-testid={`theme-pack-device-size-${pack.id}`}
              aria-label={t("settings.themePacksDeviceSize", { defaultValue: "Device size" })}
              value={sizeKey}
              onChange={(e) => setSizeKey(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-[11px]"
            >
              {WALLPAPER_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label} — {p.width}×{p.height}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid={`theme-pack-device-one-${pack.id}`}
              disabled={busy !== null}
              onClick={() => void downloadOne()}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium transition hover:bg-accent disabled:opacity-60"
            >
              {busy === "one" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {t("settings.themePacksDeviceOne", { defaultValue: "Get this size" })}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" />
          {t("settings.themePacksDeviceLocked", { defaultValue: "Device packs unlock with the pack at launch." })}
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PackCard({
  pack,
  siteMode,
  active,
  onApply,
}: {
  pack: ThemePack;
  siteMode: ThemePackMode;
  active: boolean;
  onApply: (pack: ThemePack, mode: ThemePackMode) => void;
}) {
  const { t } = useTranslation();
  const unlocked = isThemePackUnlocked(pack);
  const modes = packModes(pack);
  // The card's Light | Dark toggle: follows the site mode until the
  // visitor picks a side, then drives preview + apply + downloads.
  const [viewMode, setViewMode] = useState<ThemePackMode>(() => resolvePackMode(pack, siteMode));
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setViewMode(resolvePackMode(pack, siteMode));
  }, [pack, siteMode]);
  const variant = pack.variants[viewMode]!;
  const cursorName = CURSOR_OPTIONS.find((c) => c.id === pack.cursor)?.name ?? pack.cursor;
  const appliedHere = active && siteMode === viewMode;
  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border p-4 transition ${
        active ? "border-primary ring-1 ring-primary/50" : "border-border"
      } bg-card/60`}
      data-testid={`theme-pack-${pack.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground">{pack.name}</h3>
          <p className="text-xs text-muted-foreground">{pack.tagline}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {pack.tier === "premium" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-primary">
              <Lock className="h-3 w-3" />
              {t("settings.themePacksPremium", { defaultValue: "Premium" })}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-secondary-foreground">
              {pack.house
                ? t("settings.themePacksHouse", { defaultValue: "House theme" })
                : t("settings.themePacksIncluded", { defaultValue: "Included" })}
            </span>
          )}
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {modes.length === 2
              ? t("settings.themePacksBothModes", { defaultValue: "Light + Dark" })
              : modes[0] === "light"
                ? t("settings.themePacksLightWorld", { defaultValue: "Light world" })
                : t("settings.themePacksDarkWorld", { defaultValue: "Dark world" })}
          </span>
        </div>
      </div>

      <div
        className="inline-flex self-start overflow-hidden rounded-full border border-border"
        role="group"
        aria-label={`${pack.name} — preview light or dark`}
      >
        {(["light", "dark"] as ThemePackMode[]).map((m) => (
          <button
            key={m}
            type="button"
            data-testid={`theme-pack-mode-${pack.id}-${m}`}
            aria-pressed={viewMode === m}
            onClick={() => {
              touched.current = true;
              setViewMode(m);
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold transition ${
              viewMode === m
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "light" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
            {m === "light"
              ? t("settings.themePacksLight", { defaultValue: "Light" })
              : t("settings.themePacksDark", { defaultValue: "Dark" })}
          </button>
        ))}
      </div>

      <PackPreview variant={variant} mode={viewMode} />

      <p className="text-xs leading-relaxed text-muted-foreground">{pack.description}</p>

      <div className="mt-auto space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5" aria-hidden="true">
            {pack.swatches.map((hex) => (
              <span
                key={hex}
                className="block h-4 w-4 rounded-full border border-black/20"
                style={{ backgroundColor: hex }}
              />
            ))}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <MousePointer2 className="h-3.5 w-3.5" />
            {t("settings.themePacksPairsWith", {
              defaultValue: "Pairs with the {{cursor}} cursor",
              cursor: cursorName,
            })}
          </span>
        </div>

        {appliedHere ? (
          <button
            type="button"
            disabled
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground opacity-90"
            data-testid={`theme-pack-applied-${pack.id}`}
          >
            <Check className="h-4 w-4" />
            {t("settings.themePacksApplied", { defaultValue: "Applied" })}
          </button>
        ) : unlocked ? (
          <button
            type="button"
            onClick={() => onApply(pack, viewMode)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20"
            data-testid={`theme-pack-apply-${pack.id}`}
          >
            {t("settings.themePacksApplyIn", {
              defaultValue: "Apply in {{mode}}",
              mode:
                viewMode === "light"
                  ? t("settings.themePacksLight", { defaultValue: "Light" })
                  : t("settings.themePacksDark", { defaultValue: "Dark" }),
            })}
          </button>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-border bg-secondary/50 px-4 py-2.5 text-sm font-semibold text-muted-foreground"
            data-testid={`theme-pack-locked-${pack.id}`}
          >
            <Lock className="h-4 w-4" />
            {t("settings.themePacksComingWithLaunch", { defaultValue: "Premium pack — coming with launch" })}
          </button>
        )}

        <PackDeviceDownloads pack={pack} mode={viewMode} unlocked={unlocked} />
      </div>
    </article>
  );
}

export function ThemePacksDesk() {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>(() => getActiveThemePack().id);
  const [siteMode, setSiteMode] = useState<ThemePackMode>(() => getThemeMode());

  useEffect(() => {
    const sync = () => {
      setActiveId(getActiveThemePack().id);
      setSiteMode(getThemeMode());
    };
    sync();
    window.addEventListener(THEME_PACK_EVENT, sync);
    window.addEventListener("storage", sync);
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme-pack"] });
    return () => {
      window.removeEventListener(THEME_PACK_EVENT, sync);
      window.removeEventListener("storage", sync);
      obs.disconnect();
    };
  }, []);

  const activePack = THEME_PACKS.find((p) => p.id === activeId) ?? getActiveThemePack();

  return (
    <section
      className="rounded-2xl border border-primary/25 bg-gradient-to-b from-card to-background p-5 md:p-6"
      data-testid="theme-packs-settings"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
          <Palette className="h-4 w-4 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-bold">
            {t("settings.themePacksTitle", { defaultValue: "Theme Packs" })}
          </h2>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t("settings.themePacksDescription", {
              defaultValue:
                "One tap reskins the whole site — backgrounds, panels, buttons, accents — on phone and computer alike. Every pack comes in a designed light and dark, and can dress your actual phone and computer too. Applying a pack also sets its paired cursor; you can change the cursor any time below. The video editor keeps its own look under every pack.",
            })}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {THEME_PACKS.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            siteMode={siteMode}
            active={pack.id === activePack.id}
            onApply={(p, m) => {
              applyThemePack(p.id, { mode: m });
            }}
          />
        ))}
      </div>

      {!activePack.house && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {t("settings.themePacksUsingPack", {
              defaultValue: "You're wearing {{pack}}. The house themes are always one tap away.",
              pack: activePack.name,
            })}
          </p>
          <button
            type="button"
            onClick={() => applyThemePack(HOUSE_PACK_FOR_MODE[siteMode])}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20"
            data-testid="theme-pack-back-to-house"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("settings.themePacksBackToHouse", { defaultValue: "Back to house theme" })}
          </button>
        </div>
      )}
    </section>
  );
}
