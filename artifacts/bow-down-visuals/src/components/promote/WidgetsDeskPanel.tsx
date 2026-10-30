import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Check, Code2, Copy, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { copyText } from "@/lib/streaming";
import {
  EMBED_SIZE_KEYS,
  EMBED_SIZE_LABELS,
  WIDGET_DIMS,
  buildEmbedCode,
  embedWidgetSrc,
  type EmbedSizeKey,
  type EmbedTheme,
  type EmbedWidgetKind,
} from "@/lib/embed-widgets";

/* ─── Widgets Desk (Stack900 C1) ──────────────────────────────────────────
   Docked in Promote — never a standalone page. The signed-in creator
   picks one of their widgets (the tiny /embed/* pages other people's
   sites frame), sees THEIR OWN real widget live at phone, tablet and
   desktop widths, picks a theme + a size, and copies the iframe code
   with one tap. Inventory comes from GET /api/embed/mine; a widget the
   creator can't power yet (no public profile, no tip page, no shop
   items) is shown honestly with the door to set it up. */

interface MineProduct {
  id: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  shop_handle: string;
}

interface Mine {
  profile: { slug: string; display_name: string; is_public: boolean } | null;
  tip_handle: string | null;
  live: { is_live: boolean; stream: { id: string; title: string; viewer_count: number } | null } | null;
  products: MineProduct[];
}

interface KindInfo {
  key: EmbedWidgetKind;
  name: string;
  blurb: string;
}

const KINDS: KindInfo[] = [
  { key: "profile", name: "Profile card", blurb: "Your face, your name, and a follow button — anywhere." },
  { key: "latest", name: "Latest video", blurb: "Your newest video or short, playable right there." },
  { key: "tips", name: "Tip jar", blurb: "Your tip jar card — fans tap through and tip on your own Bow Down page." },
  { key: "live", name: "Live badge", blurb: "Says LIVE with your viewer count while you're on — and flips on its own." },
  { key: "product", name: "Shop item", blurb: "One item from your shop, with its price and a door to buy." },
];

export function WidgetsDeskPanel() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [mine, setMine] = useState<Mine | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [kind, setKind] = useState<EmbedWidgetKind>("profile");
  const [theme, setTheme] = useState<EmbedTheme>("dark");
  const [size, setSize] = useState<EmbedSizeKey>("phone");
  const [productId, setProductId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/embed/mine", {
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error("mine failed");
        const data = (await res.json()) as Mine;
        if (cancelled) return;
        setMine(data);
        if (data.products[0]) setProductId(data.products[0].id);
        if (data.profile?.slug) {
          try {
            const r = await fetch(`/api/embed/refcode/${encodeURIComponent(data.profile.slug)}`, {
              headers: { Accept: "application/json" },
            });
            if (r.ok) {
              const d = (await r.json()) as { code?: string | null };
              if (!cancelled && typeof d.code === "string" && d.code) setRefCode(d.code);
            }
          } catch {
            /* the code simply goes out without a ref — never a blocker */
          }
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://bowdownvisuals.com";
  const slug = mine?.profile?.slug ?? null;
  const profilePublic = !!mine?.profile?.is_public;
  const product = mine?.products.find((p) => p.id === productId) ?? mine?.products[0] ?? null;

  const target = useMemo(() => {
    switch (kind) {
      case "profile":
      case "latest":
      case "live":
        return slug;
      case "tips":
        return mine?.tip_handle ?? null;
      case "product":
        return product?.id ?? null;
    }
  }, [kind, slug, mine?.tip_handle, product]);

  const kindBlocked =
    ((kind === "profile" || kind === "latest" || kind === "live") && (!slug || !profilePublic)) ||
    (kind === "tips" && !mine?.tip_handle) ||
    (kind === "product" && !product);

  const widgetTitle =
    kind === "product" && product
      ? product.name
      : (KINDS.find((k) => k.key === kind)?.name ?? "Widget");

  const code =
    target && !kindBlocked
      ? buildEmbedCode(origin, kind, { target, refCode }, theme, size, widgetTitle)
      : "";

  async function handleCopy() {
    if (!code) return;
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  const cardCls = `rounded-2xl border p-6 md:p-8 ${
    isLight
      ? "border-[#C9A84C]/40 bg-gradient-to-b from-white/[0.05] to-[#F4E7C3]"
      : "border-primary/25 bg-gradient-to-b from-white/[0.05] to-[#0d0a04]"
  }`;
  const pill = (active: boolean) =>
    "rounded-xl px-4 py-2.5 text-sm font-semibold transition border " +
    (active
      ? "border-primary/60 bg-primary/15 text-white"
      : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white");

  if (!user) {
    return (
      <div className={`${cardCls} text-center`} data-testid="widgets-desk">
        <h2 className="text-xl font-bold">{t("promote.widgets.title", { defaultValue: "Widgets for your other pages" })}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
          {t("promote.widgets.signIn", { defaultValue: "Sign in to get widgets with your own profile, videos, tip jar and shop on them." })}
        </p>
        <Link href="/login">
          <span className="mt-4 inline-block cursor-pointer rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110">
            {t("promote.widgets.signInCta", { defaultValue: "Sign in" })}
          </span>
        </Link>
      </div>
    );
  }

  return (
    <div className={cardCls} data-testid="widgets-desk">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-amber-400/25 to-yellow-600/10">
          <Code2 className="h-5 w-5 text-primary" />
        </span>
        <div>
          <h2 className="text-xl font-bold">{t("promote.widgets.title", { defaultValue: "Widgets for your other pages" })}</h2>
          <p className="mt-0.5 text-sm text-white/55">
            {t("promote.widgets.intro", {
              defaultValue:
                "Put your Bow Down on any website — pick a widget, copy the code, paste it where your site goes. Every widget fits phones, tablets and computers: pick a size and see yours before you copy.",
            })}
          </p>
        </div>
      </div>

      {!mine && !loadFailed && (
        <div className="mt-6 flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("promote.widgets.loading", { defaultValue: "Getting your widgets…" })}
        </div>
      )}
      {loadFailed && (
        <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {t("promote.widgets.loadFailed", { defaultValue: "Couldn't load your widgets just now — refresh the page and they'll be here." })}
        </p>
      )}

      {mine && !slug && (
        <div className="mt-6 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70">
          {t("promote.widgets.needProfile", { defaultValue: "Widgets wear your artist profile — set yours up first, then come back and they'll be wearing your face." })}{" "}
          <Link href="/artist-setup" className="font-bold text-primary underline">
            {t("promote.widgets.needProfileCta", { defaultValue: "Set up your profile" })}
          </Link>
        </div>
      )}
      {mine && slug && !profilePublic && (
        <div className="mt-6 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70">
          {t("promote.widgets.privateProfile", { defaultValue: "Your profile is private right now, so widgets can't show it. Make your profile public and they'll light up." })}
        </div>
      )}

      {mine && (
        <>
          {/* Widget picker */}
          <label className="mt-7 block text-xs font-bold uppercase tracking-widest text-white/45">
            {t("promote.widgets.pick", { defaultValue: "Pick a widget" })}
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {KINDS.map((k) => (
              <button key={k.key} onClick={() => setKind(k.key)} className={pill(kind === k.key) + " text-left"}>
                <div className="font-semibold">{k.name}</div>
                <div className="mt-0.5 text-xs font-normal text-white/40">{k.blurb}</div>
              </button>
            ))}
          </div>

          {kind === "product" && mine.products.length > 0 && (
            <>
              <label className="mt-5 block text-xs font-bold uppercase tracking-widest text-white/45">
                {t("promote.widgets.pickProduct", { defaultValue: "Which item?" })}
              </label>
              <select
                value={product?.id ?? ""}
                aria-label={t("promote.widgets.pickProduct", { defaultValue: "Which item?" })}
                onChange={(e) => setProductId(e.target.value)}
                className="mt-2 w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white outline-none transition focus:border-primary/60"
              >
                {mine.products.map((p) => (
                  <option key={p.id} value={p.id} className="bg-black">
                    {p.name} — {p.price_cents > 0 ? `$${(p.price_cents / 100).toFixed(2)}` : "Free"}
                  </option>
                ))}
              </select>
            </>
          )}

          {kind === "tips" && !mine.tip_handle && (
            <p className="mt-4 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70">
              {t("promote.widgets.needTips", { defaultValue: "You don't have a tip jar yet — open yours and this widget lights up." })}{" "}
              <Link href="/tips" className="font-bold text-primary underline">
                {t("promote.widgets.needTipsCta", { defaultValue: "Open your tip jar" })}
              </Link>
            </p>
          )}
          {kind === "product" && mine.products.length === 0 && (
            <p className="mt-4 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70">
              {t("promote.widgets.needProduct", { defaultValue: "Your shop has no items showing yet — add one and this widget wears it." })}{" "}
              <Link href="/my-shop" className="font-bold text-primary underline">
                {t("promote.widgets.needProductCta", { defaultValue: "Open your shop" })}
              </Link>
            </p>
          )}
          {kind === "live" && mine.live && !mine.live.is_live && (
            <p className="mt-4 text-sm text-white/50">
              {t("promote.widgets.liveOffline", { defaultValue: "You're not live right now — the badge shows your profile until you go live, then it flips to LIVE on its own." })}
            </p>
          )}

          {/* Theme + size */}
          <div className="mt-6 flex flex-wrap items-end gap-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-white/45">
                {t("promote.widgets.theme", { defaultValue: "Look" })}
              </label>
              <div className="mt-2 flex gap-2">
                {(["dark", "light"] as EmbedTheme[]).map((th) => (
                  <button key={th} onClick={() => setTheme(th)} className={pill(theme === th)}>
                    {th === "dark"
                      ? t("promote.widgets.themeDark", { defaultValue: "Dark" })
                      : t("promote.widgets.themeLight", { defaultValue: "Light" })}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-widest text-white/45">
                {t("promote.widgets.size", { defaultValue: "Size" })}
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {EMBED_SIZE_KEYS.map((sk) => {
                  const d = WIDGET_DIMS[kind][sk];
                  return (
                    <button key={sk} onClick={() => setSize(sk)} className={pill(size === sk)}>
                      {EMBED_SIZE_LABELS[sk]} · {d.w} × {d.h}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Live previews at all three widths */}
          {!kindBlocked && target ? (
            <div className="mt-7 space-y-5">
              {EMBED_SIZE_KEYS.map((sk) => {
                const d = WIDGET_DIMS[kind][sk];
                const src = embedWidgetSrc(origin, kind, { target, refCode }, theme);
                return (
                  <div key={sk}>
                    <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-white/45">
                      {EMBED_SIZE_LABELS[sk]} · {d.w} × {d.h}
                    </div>
                    <div className="overflow-x-auto pb-1">
                      <div
                        className={`overflow-hidden rounded-2xl border ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}
                        style={{ width: d.w, height: d.h, maxWidth: "100%" }}
                      >
                        <iframe
                          src={src}
                          width={d.w}
                          height={d.h}
                          style={{ border: 0, display: "block" }}
                          loading="lazy"
                          title={`${widgetTitle} widget — ${EMBED_SIZE_LABELS[sk]} preview`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-7 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/60">
              {t("promote.widgets.previewBlocked", { defaultValue: "Once this one is set up, you'll see it here at phone, tablet and desktop sizes before you copy anything." })}
            </p>
          )}

          {/* The code + one-tap copy */}
          {code && (
            <div className="mt-7">
              <label className="block text-xs font-bold uppercase tracking-widest text-white/45">
                {t("promote.widgets.codeLabel", { defaultValue: "Your code — paste it where your site goes" })}
              </label>
              <div className="mt-2 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-xs leading-relaxed text-white/75">
                  {code}
                </code>
                <button
                  onClick={handleCopy}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    copied
                      ? "border-[#e8c86a] bg-[#e8c86a]/15 text-[#e8c86a]"
                      : "border-white/15 bg-white/[0.05] text-white/70 hover:border-primary/50 hover:text-white"
                  }`}
                  aria-label={t("promote.widgets.copyLabel", { defaultValue: "Copy the widget code" })}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied
                    ? t("promote.widgets.copied", { defaultValue: "Copied!" })
                    : t("promote.widgets.copy", { defaultValue: "Copy code" })}
                </button>
              </div>
              <p className="mt-2 text-xs text-white/40">
                {t("promote.widgets.codeNote", {
                  defaultValue:
                    "The size in the code is the size you picked. On a smaller screen it shrinks to fit instead of breaking the page.",
                })}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
