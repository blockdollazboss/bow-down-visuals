import { useEffect, useState } from "react";
import {
  Check, Copy, Download, Loader2, Lock, Share2, SlidersHorizontal, Sparkles, Store,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  hslToHex,
  type ThemePack,
  type ThemePackMode,
} from "@/lib/theme-packs";
import {
  APPROVED_ART_SOURCES,
  ICON_NAMES,
  KIT_COMPONENTS,
  KIT_DEVICES,
  buildChromeThemeManifest,
  buildShareCardSvg,
  encodeLook,
  kitManifest,
  renderFolderIconSvg,
  renderIconSvg,
  renderWidgetSvg,
  sanitizeCustomization,
  type KitDevice,
  type PackCustomization,
} from "@/lib/theme-kit";

/* ─── Whole-device kit panel (Stack-200 UPGRADES #39) ─────────────────
   Mounted inside every pack card of the ThemePacksDesk. Delivers the
   12-component kit: per-platform bundle downloads through the server
   kit rail (POST /api/theme-packs/kit/:id/download — Windows is a real
   .themepack), the customization capstone (every component, per
   device, saved through PUT /api/theme-packs/customizations/:id), the
   GET THIS LOOK share + share card, and — in the desk-level section
   below the grid — the creator-pack designer + store.

   Sound sync (owner ruling Oct 25 17:39): the ringtone / notification
   / sound-scheme components ARE the site sound library's signature
   set by role. Applying a pack applies those sounds (the desk's apply
   stamps the library set choice); bundles carry the library files
   under their manifest names — no per-pack copies exist. Pack sound
   customization is ADDITIVE only (extraSoundRole).

   Fonts: pack surfaces set the approved house pairing — Cinzel for
   display, Manrope for body (board item 179). */

const DISPLAY = { fontFamily: "Cinzel, serif" } as const;
const BODY = { fontFamily: "Manrope, sans-serif" } as const;

const BUNDLES: Array<{ kind: string; label: string }> = [
  { kind: "windows", label: "Windows (.themepack)" },
  { kind: "mac", label: "Mac set" },
  { kind: "android", label: "Android set" },
  { kind: "ios", label: "iPhone / iPad kit" },
  { kind: "chrome", label: "Chrome theme" },
  { kind: "sounds", label: "Sounds (library set)" },
  { kind: "full", label: "Everything (.zip)" },
];

export function ThemeKitPanel({
  pack,
  mode,
  unlocked,
  previewMix,
}: {
  pack: ThemePack;
  mode: ThemePackMode;
  unlocked: boolean;
  previewMix?: PackCustomization | null;
}) {
  const { getAccessToken } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mix, setMix] = useState<PackCustomization>(() => previewMix ?? {});
  const [copied, setCopied] = useState(false);
  const manifest = kitManifest(pack);

  useEffect(() => {
    if (previewMix) setMix(previewMix);
  }, [previewMix]);

  useEffect(() => {
    // Load the buyer's saved customization for this pack.
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch(`/api/theme-packs/customizations/${pack.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { mix?: PackCustomization };
        if (!cancelled && json.mix && Object.keys(json.mix).length > 0) setMix(json.mix);
      } catch { /* desk still renders with the default mix */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.id]);

  const download = async (kind: string) => {
    setBusy(kind); setError(null); setDone(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("signin");
      const iconSvgs: Record<string, string> = {};
      for (const name of ICON_NAMES) {
        iconSvgs[`${name}-light`] = renderIconSvg(pack, "light", name);
        iconSvgs[`${name}-dark`] = renderIconSvg(pack, "dark", name);
      }
      const res = await fetch(`/api/theme-packs/kit/${pack.id}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          kind,
          mode,
          assets: {
            iconSvgs,
            folderSvg: renderFolderIconSvg(pack, mode),
            widgetSvg: renderWidgetSvg(pack, mode),
            chromeManifest: JSON.stringify(buildChromeThemeManifest(pack, mode), null, 2),
            shareCardSvg: buildShareCardSvg(pack, mode),
          },
        }),
      });
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = kind === "windows" ? `${pack.id}-${mode}.themepack` : `${pack.id}-${mode}-${kind}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setDone(kind);
    } catch {
      setError("That download hit a snag — try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const saveMix = async () => {
    setBusy("save"); setError(null);
    try {
      const clean = sanitizeCustomization(mix);
      if (!clean.ok) throw new Error(clean.error);
      const token = await getAccessToken();
      if (!token) throw new Error("signin");
      const res = await fetch(`/api/theme-packs/customizations/${pack.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mix: clean.value }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setDone("save");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That save hit a snag.");
    } finally {
      setBusy(null);
    }
  };

  const copyLook = async () => {
    const url = `${window.location.origin}/settings?look=${encodeLook({ packId: pack.id, mix })}#theme-packs`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Copy didn't work here — your look link is in the address of the share card download instead.");
    }
  };

  const downloadShareCard = () => {
    const svg = buildShareCardSvg(pack, mode);
    const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = `${pack.id}-${mode}-share-card.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const setComp = (component: string, device: KitDevice, patch: Record<string, unknown>) => {
    setMix((prev) => ({
      ...prev,
      [component]: {
        ...(prev as Record<string, unknown>)[component] as object,
        [device]: {
          ...(((prev as Record<string, Record<string, unknown>>)[component]?.[device]) ?? {}),
          ...patch,
        },
      },
    }) as PackCustomization);
  };

  return (
    <div className="border-t border-border/60 pt-3" style={BODY} data-testid={`theme-kit-${pack.id}`}>
      <p className="text-[11px] font-semibold text-foreground" style={DISPLAY}>
        The whole-device kit — {manifest.components.length} components, light + dark
      </p>
      <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5" aria-label={`${pack.name} kit components`}>
        {manifest.components.map((c) => (
          <li key={c.component} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Check className="h-3 w-3 shrink-0" /> {c.label}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        Sounds sync from the site sound library — this pack's ringtone, notifications and
        sound scheme are the signature set by role, the same files the site plays.
        Applying the pack applies them. iPhone/iPad icons use Apple's Shortcuts route —
        guided setup included, no fake system theme.
      </p>

      {unlocked ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {BUNDLES.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                data-testid={`theme-kit-download-${kind}-${pack.id}`}
                disabled={busy !== null}
                onClick={() => void download(kind)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium transition hover:bg-accent disabled:opacity-60"
              >
                {busy === kind ? <Loader2 className="h-3 w-3 animate-spin" /> : done === kind ? <Check className="h-3 w-3" /> : <Download className="h-3 w-3" />}
                {label}
              </button>
            ))}
          </div>

          <details className="mt-3" data-testid={`theme-kit-customize-${pack.id}`}>
            <summary className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-foreground">
              <SlidersHorizontal className="h-3 w-3" /> Customize everything — per component, per device
            </summary>
            <div className="mt-2 space-y-2">
              {KIT_COMPONENTS.map((c) => (
                <div key={c.id} className="rounded-lg border border-border/60 p-2">
                  <p className="text-[11px] font-semibold">{c.label}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <select
                      aria-label={`${c.label} art source`}
                      className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px]"
                      value={(mix[c.id as keyof PackCustomization]?.all?.artSourceId as string) ?? "pack-ground"}
                      onChange={(e) => setComp(c.id, "all", { artSourceId: e.target.value })}
                    >
                      {APPROVED_ART_SOURCES.map((a) => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                      ))}
                    </select>
                    <input
                      type="color"
                      aria-label={`${c.label} accent color`}
                      className="h-6 w-9 rounded border border-border bg-background"
                      value={(mix[c.id as keyof PackCustomization]?.all?.accentHex as string) ?? hslToHex(pack.variants[mode]!.tokens.primary) ?? "#f9bc06"}
                      onChange={(e) => setComp(c.id, "all", { accentHex: e.target.value })}
                    />
                    <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={(mix[c.id as keyof PackCustomization]?.all?.branded as boolean) ?? true}
                        onChange={(e) => setComp(c.id, "all", { branded: e.target.checked })}
                      />
                      Logo on art
                    </label>
                    <select
                      aria-label={`${c.label} device`}
                      className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px]"
                      defaultValue="all"
                      onChange={(e) => {
                        const device = e.target.value as KitDevice;
                        const current = (mix[c.id as keyof PackCustomization]?.all) ?? {};
                        setComp(c.id, device, { ...current });
                      }}
                    >
                      {KIT_DEVICES.map((d) => (
                        <option key={d} value={d}>{d === "all" ? "All devices" : d}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              <button
                type="button"
                data-testid={`theme-kit-save-${pack.id}`}
                disabled={busy !== null}
                onClick={() => void saveMix()}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary disabled:opacity-60"
              >
                {busy === "save" ? <Loader2 className="h-3 w-3 animate-spin" /> : done === "save" ? <Check className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                Save my mix
              </button>
            </div>
          </details>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid={`theme-kit-look-${pack.id}`}
              onClick={() => void copyLook()}
              className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
            >
              {copied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
              {copied ? "Look link copied" : "Get this look — share"}
            </button>
            <button
              type="button"
              data-testid={`theme-kit-sharecard-${pack.id}`}
              onClick={downloadShareCard}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium"
            >
              <Copy className="h-3 w-3" /> Share card
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Sharing carries your exact mix. A paid pack's link lands on the pack wearing
            your mix as a preview — the price still applies to own it.
          </p>
        </>
      ) : (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" /> The whole kit — downloads, customization, sharing — unlocks with the pack.
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

/* ─── Creator-made packs: designer + store (desk-level section) ────── */

export function CreatorPacksSection() {
  const { getAccessToken, user } = useAuth();
  const [name, setName] = useState("");
  const [basePackId, setBasePackId] = useState("golden-marble");
  const [priceVb, setPriceVb] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [packs, setPacks] = useState<Array<{ id: string; name: string; priceVb: number; published: boolean; creatorUserId: string }>>([]);

  const load = async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/theme-packs/creator-packs", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const json = (await res.json()) as { packs?: typeof packs };
      setPacks(json.packs ?? []);
    } catch { /* section still renders */ }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  const create = async (publish: boolean) => {
    setBusy(true); setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to design a pack.");
      const res = await fetch("/api/theme-packs/creator-packs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, basePackId, priceVb, mix: {} }),
      });
      const json = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok || !json?.id) throw new Error(json?.message ?? "That design hit a snag.");
      if (publish) {
        await fetch(`/api/theme-packs/creator-packs/${json.id}/publish`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      setMessage(publish ? "Your pack is live in the creator store below." : "Draft saved — publish it when the mix is right.");
      setName("");
      void load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That design hit a snag.");
    } finally {
      setBusy(false);
    }
  };

  const buy = async (id: string) => {
    setBusy(true); setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to buy a creator pack.");
      const res = await fetch(`/api/theme-packs/creator-packs/${id}/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) throw new Error(json?.message ?? "That purchase hit a snag.");
      setMessage("Pack owned — find it in your kit downloads above, wearing the creator's mix.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That purchase hit a snag.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-5 rounded-2xl border border-border bg-card/60 p-4" style={BODY} data-testid="creator-packs-section">
      <h3 className="flex items-center gap-2 text-sm font-bold" style={{ fontFamily: "Cinzel, serif" }}>
        <Store className="h-4 w-4" /> Creator-made packs
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        Design a pack from a house base with the customization layer, then sell it or give it
        away in your store. Sales ride the store rails: the flat 5% platform fee comes off the
        top, you keep 95% in Visual Bucs. Fans wear your look — paid packs still respect the price.
      </p>
      {user ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold">
            Pack name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px]" placeholder="Midnight Royalty" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold">
            Base pack
            <select value={basePackId} onChange={(e) => setBasePackId(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px]">
              <option value="golden-marble">Golden Marble</option>
              <option value="shark-tank">Shark Tank</option>
              <option value="golden-hour">Golden Hour</option>
              <option value="kings-set">The King's Set</option>
              <option value="arcade-gold">Arcade Gold</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold">
            Price (VB, 0 = free)
            <input type="number" min={0} max={100000} value={priceVb} onChange={(e) => setPriceVb(Number(e.target.value))}
              className="w-28 rounded-lg border border-border bg-background px-2 py-1.5 text-[11px]" />
          </label>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void create(false)}
            className="rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-60">
            Save draft
          </button>
          <button type="button" disabled={busy || !name.trim()} onClick={() => void create(true)}
            data-testid="creator-pack-publish"
            className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary disabled:opacity-60">
            Publish to my store
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">Sign in to design and sell your own packs.</p>
      )}
      {message ? <p className="mt-2 text-[11px] text-muted-foreground" role="status">{message}</p> : null}
      {packs.length > 0 ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {packs.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2">
              <span className="text-[11px]">
                <span className="font-semibold text-foreground">{p.name}</span>
                <span className="text-muted-foreground"> — {p.priceVb === 0 ? "Free" : `${p.priceVb.toLocaleString()} VB`}{p.published ? "" : " · draft"}</span>
              </span>
              {p.published ? (
                <button type="button" disabled={busy} onClick={() => void buy(p.id)}
                  data-testid={`creator-pack-buy-${p.id}`}
                  className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary disabled:opacity-60">
                  {p.priceVb === 0 ? "Get it" : "Buy"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
