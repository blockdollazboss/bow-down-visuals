import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Camera, Loader2, Sparkles, ImagePlus, Upload, Link2, Download,
  Check, Wand2, LayoutGrid, PenLine, Shirt,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { r2List } from "@/lib/r2-storage";

/* ─── Product Photo Studio ────────────────────────────────────────────────
   AI product photography for the SELL flow (branding shop / storefront):
   clean white-background packshots + styled lifestyle scenes, generated
   from the seller's own product photo.

   Difficulty ladder: AI Autopilot (default, simple) → Scene presets →
   Custom prompt (full manual). Pure UI is free; only the generation call
   costs credits (credit confirmation via useConfirmedApi).

   Docks into src/pages/branding-shop.tsx (studio tab) — this file is
   standalone; the host page mounts <ProductPhotoStudio />.
   ───────────────────────────────────────────────────────────────────────── */

/* Placeholder prices — NOT user-approved. Report changes here. */
const PACKSHOT_CREDITS = 100;
const LIFESTYLE_CREDITS = 150;

type ShotType = "packshot" | "lifestyle";
type StyleMode = "autopilot" | "presets" | "custom";
type PhotoModel = "nano-banana-2.1" | "ideogram-4.0";
type PhotoRatio = "1080:1080" | "1080:1920";
type ProductKind = "apparel" | "drinkware" | "jewelry" | "poster" | "accessory" | "home" | "other";

interface PresetDef { id: string; nameKey: string; blurbKey: string }

const PACKSHOT_PRESETS: PresetDef[] = [
  { id: "studio-white", nameKey: "preset.studioWhite", blurbKey: "preset.studioWhiteBlurb" },
  { id: "light-grey", nameKey: "preset.lightGrey", blurbKey: "preset.lightGreyBlurb" },
  { id: "infinity-white", nameKey: "preset.infinityWhite", blurbKey: "preset.infinityWhiteBlurb" },
];

const LIFESTYLE_PRESETS: PresetDef[] = [
  { id: "marble-luxe", nameKey: "preset.marbleLuxe", blurbKey: "preset.marbleLuxeBlurb" },
  { id: "street-style", nameKey: "preset.streetStyle", blurbKey: "preset.streetStyleBlurb" },
  { id: "golden-hour", nameKey: "preset.goldenHour", blurbKey: "preset.goldenHourBlurb" },
  { id: "cozy-home", nameKey: "preset.cozyHome", blurbKey: "preset.cozyHomeBlurb" },
];

const PRODUCT_KINDS: Array<{ id: ProductKind; key: string }> = [
  { id: "apparel", key: "kind.apparel" },
  { id: "drinkware", key: "kind.drinkware" },
  { id: "jewelry", key: "kind.jewelry" },
  { id: "poster", key: "kind.poster" },
  { id: "accessory", key: "kind.accessory" },
  { id: "home", key: "kind.home" },
  { id: "other", key: "kind.other" },
];

interface RecentUpload { name: string; url: string }

interface ProductPhotoStudioProps {
  /** Prefill the product photo (e.g. a merch mockup from the studio tab). */
  initialProductUrl?: string | null;
  initialProductName?: string;
  /** Called when a photo is generated — host can set it as the listing photo. */
  onGenerated?: (url: string, path: string | null) => void;
  userId?: string | null;
}

export function ProductPhotoStudio({ initialProductUrl, initialProductName, onGenerated, userId }: ProductPhotoStudioProps) {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const isLight = useIsLightTheme();

  /* tr() keeps every string keyed for i18n (productPhotoStudio.*) while
     rendering English via defaultValue until en.json is merged. */
  const tr = (key: string, fallback: string, opts?: Record<string, unknown>) =>
    t(`productPhotoStudio.${key}`, { defaultValue: fallback, ...(opts ?? {}) });

  const [productUrl, setProductUrl] = useState(initialProductUrl ?? "");
  const [productName, setProductName] = useState(initialProductName ?? "");
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [recent, setRecent] = useState<RecentUpload[] | null>(null);
  const [shotType, setShotType] = useState<ShotType>("packshot");
  const [styleMode, setStyleMode] = useState<StyleMode>("autopilot");
  const [kind, setKind] = useState<ProductKind>("apparel");
  const [presetId, setPresetId] = useState("studio-white");
  const [customPrompt, setCustomPrompt] = useState("");
  const [model, setModel] = useState<PhotoModel>("nano-banana-2.1");
  const [ratio, setRatio] = useState<PhotoRatio>("1080:1080");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; path: string | null } | null>(null);

  const effectiveUserId = userId ?? user?.id ?? null;
  const creditCost = shotType === "lifestyle" ? LIFESTYLE_CREDITS : PACKSHOT_CREDITS;
  const presets = shotType === "packshot" ? PACKSHOT_PRESETS : LIFESTYLE_PRESETS;

  function switchShot(next: ShotType) {
    setShotType(next);
    setPresetId(next === "packshot" ? "studio-white" : "marble-luxe");
    setResult(null);
  }

  /* ── Product photo source: direct R2 upload (presigned) ── */
  async function handleFile(file: File) {
    if (!effectiveUserId) { setError(tr("errorSignIn", "Sign in to upload a product photo.")); return; }
    if (!file.type.startsWith("image/")) { setError(tr("errorNotImage", "That file is not an image.")); return; }
    setUploading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
      const key = `${effectiveUserId}/product-photos/source/${crypto.randomUUID()}.${ext}`;
      const presign = await fetch("/api/r2/presign-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ key, contentType: file.type }),
      });
      if (!presign.ok) throw new Error(tr("errorUpload", "Could not start the upload. Try again."));
      const { uploadUrl, publicUrl } = await presign.json() as { uploadUrl: string; publicUrl: string };
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(tr("errorUpload", "Could not start the upload. Try again."));
      setProductUrl(publicUrl);
      setRecent(null); // refresh the recents list next open
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("errorUpload", "Could not start the upload. Try again."));
    } finally {
      setUploading(false);
    }
  }

  async function loadRecent() {
    if (!effectiveUserId || recent) return;
    try {
      const token = await getAccessToken();
      const files = await r2List(`${effectiveUserId}/product-photos/source`, token);
      setRecent(
        files
          .filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name))
          .slice(0, 8)
          .map((f) => ({ name: f.name, url: f.url })),
      );
    } catch { /* best-effort */ }
  }

  /* ── Generation (synchronous — Nano Banana / Ideogram return the image) ── */
  async function startGeneration() {
    if (!productUrl.trim()) { setError(tr("errorNoProduct", "Upload a product photo first — the AI needs to see your product.")); return; }
    if (styleMode === "custom" && !customPrompt.trim()) { setError(tr("errorNoPrompt", "Describe the scene first.")); return; }
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/generate-product-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          productImageUrl: productUrl.trim(),
          productName: productName.trim() || null,
          productKind: styleMode === "autopilot" ? kind : null,
          shotType,
          styleMode,
          scenePreset: styleMode === "presets" ? presetId : null,
          customPrompt: styleMode === "custom" ? customPrompt.trim() : null,
          model,
          ratio,
        }),
        overrideCost: creditCost,
        overrideFeature: tr("confirmFeature", "Product Photo Studio"),
      });
      if (!res) { setGenerating(false); return; } // user cancelled the credit confirmation
      const data = await res.json() as { status?: string; url?: string | null; path?: string | null; error?: string; message?: string };
      if (!res.ok || data.status !== "succeeded" || !data.url) {
        throw new Error(data.message ?? data.error ?? tr("errorFailed", `Photo API error (HTTP ${res.status})`));
      }
      setResult({ url: data.url, path: data.path ?? null });
      refreshProfile();
      onGenerated?.(data.url, data.path ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : tr("errorFailed", "Photo generation failed.");
      setError(msg === "out_of_credits" ? tr("errorCredits", "Not enough Visual Bucs. Please buy more Visual Bucs to continue.") : msg);
    } finally {
      setGenerating(false);
    }
  }

  const chipClass = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
      active
        ? "border-primary/60 bg-primary/15 text-primary"
        : "border-white/10 bg-white/5 text-white/50 hover:text-white/80"
    } disabled:opacity-50`;

  const stepLabel = "mb-2 block text-xs font-bold uppercase tracking-widest text-white/40";

  return (
    <div className={`overflow-hidden rounded-2xl border border-primary/25 ${isLight ? "bg-white shadow-[0_8px_32px_rgba(138,107,31,0.10)]" : "bg-gradient-to-br from-neutral-900 via-black to-neutral-900"}`}>
      <div className="p-6 md:p-8">
        {/* header */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <Camera className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">{tr("title", "Product Photo Studio")}</h2>
            <p className="text-xs text-white/45">{tr("subtitle", "Clean packshots and lifestyle shots for your merch — ready to sell.")}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            {/* ── 1. product ── */}
            <div>
              <span className={stepLabel}>{tr("stepProduct", "1. Your product")}</span>
              {productUrl ? (
                <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <img src={productUrl} alt={tr("productAlt", "Product photo")} className="h-16 w-16 rounded-lg border border-white/10 object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-green-400">
                      <Check className="h-3.5 w-3.5" /> {tr("productReady", "Product photo ready")}
                    </div>
                    <button onClick={() => setProductUrl("")} className="mt-1 text-xs text-white/40 underline hover:text-white">
                      {tr("changePhoto", "Use a different photo")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-5 text-sm font-bold text-primary transition hover:border-primary/60 hover:bg-primary/10">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? tr("uploading", "Uploading…") : tr("uploadCta", "Upload product photo")}
                    <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }} />
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder={tr("pastePlaceholder", "https://…")}
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-primary/50 focus:outline-none"
                    />
                    <button
                      onClick={() => { if (urlInput.trim()) { setProductUrl(urlInput.trim()); setUrlInput(""); } }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/60 hover:border-primary/40 hover:text-white"
                    >
                      <Link2 className="h-3.5 w-3.5" /> {tr("useUrl", "Use URL")}
                    </button>
                  </div>
                  <button onClick={() => void loadRecent()} className="text-xs text-white/40 underline hover:text-white">
                    {tr("recentLabel", "Pick from recent uploads")}
                  </button>
                  {recent && recent.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {recent.map((r) => (
                        <button key={r.url} onClick={() => setProductUrl(r.url)} className="overflow-hidden rounded-lg border border-white/10 hover:border-primary/50">
                          <img src={r.url} alt={r.name} className="h-14 w-14 object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder={tr("namePlaceholder", "Product name (optional — e.g. Gold Chain Tee)")}
                maxLength={120}
                className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-primary/50 focus:outline-none"
              />
            </div>

            {/* ── 2. shot type ── */}
            <div>
              <span className={stepLabel}>{tr("stepShot", "2. Shot type")}</span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: "packshot", icon: ImagePlus, nameKey: "packshot", blurbKey: "packshotBlurb" },
                    { id: "lifestyle", icon: Sparkles, nameKey: "lifestyle", blurbKey: "lifestyleBlurb" },
                  ] as Array<{ id: ShotType; icon: typeof ImagePlus; nameKey: string; blurbKey: string }>
                ).map((s) => {
                  const Icon = s.icon;
                  const active = shotType === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => switchShot(s.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        active ? "border-primary bg-primary/10" : "border-white/10 hover:border-white/25"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-white/40"}`} />
                      <div className={`mt-1.5 text-sm font-bold ${active ? "text-primary" : "text-white"}`}>
                        {tr(s.nameKey, s.id === "packshot" ? "Packshot" : "Lifestyle")}
                      </div>
                      <div className="mt-0.5 text-xs text-white/40">
                        {tr(s.blurbKey, s.id === "packshot"
                          ? "Clean white-background product photo for your storefront."
                          : "Your product styled in a real scene — ads, socials, banners.")}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* ── 3. scene style: autopilot → presets → manual ── */}
            <div>
              <span className={stepLabel}>{tr("stepStyle", "3. Scene style")}</span>
              <div className="mb-3 flex flex-wrap gap-2">
                {(
                  [
                    { id: "autopilot", icon: Wand2, labelKey: "modeAutopilot", fallback: "Turbo Mode" },
                    { id: "presets", icon: LayoutGrid, labelKey: "modePresets", fallback: "Scene presets" },
                    { id: "custom", icon: PenLine, labelKey: "modeCustom", fallback: "Custom prompt" },
                  ] as Array<{ id: StyleMode; icon: typeof Wand2; labelKey: string; fallback: string }>
                ).map((m) => {
                  const Icon = m.icon;
                  return (
                    <button key={m.id} onClick={() => setStyleMode(m.id)} className={chipClass(styleMode === m.id)}>
                      <span className="inline-flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" />{tr(m.labelKey, m.fallback)}</span>
                    </button>
                  );
                })}
              </div>

              {styleMode === "autopilot" && (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 text-xs font-semibold text-white/60">{tr("kindLabel", "What are you selling? AI picks the fitting scene.")}</div>
                  <div className="flex flex-wrap gap-2">
                    {PRODUCT_KINDS.map((k) => (
                      <button key={k.id} onClick={() => setKind(k.id)} className={chipClass(kind === k.id)}>
                        {tr(k.key, k.id)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {styleMode === "presets" && (
                <div className="grid grid-cols-2 gap-2">
                  {presets.map((p) => {
                    const active = presetId === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPresetId(p.id)}
                        className={`rounded-xl border p-3 text-left transition ${
                          active ? "border-primary bg-primary/10" : "border-white/10 hover:border-white/25"
                        }`}
                      >
                        <div className={`text-sm font-bold ${active ? "text-primary" : "text-white"}`}>{tr(p.nameKey, p.id)}</div>
                        <div className="mt-0.5 text-xs text-white/40">{tr(p.blurbKey, "")}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {styleMode === "custom" && (
                <div data-min-stars="4">
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder={tr("customPlaceholder", "e.g. Your hoodie laid flat on a marble table next to gold sunglasses, soft morning light…")}
                    rows={4}
                    maxLength={2000}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-primary/50 focus:outline-none"
                  />
                  <div className="mt-1 text-xs text-white/35">{tr("customHint", "Full manual control — describe the exact scene, lighting, and background.")}</div>
                </div>
              )}
            </div>

            {/* ── 4. model & size ── */}
            <div>
              <span className={stepLabel}>{tr("stepModel", "4. Model & size")}</span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: "nano-banana-2.1", nameKey: "modelNano", blurbKey: "modelNanoBlurb", fb: "Turbo Render", fbB: "Fast — keeps your product pixel-accurate." },
                    { id: "ideogram-4.0", nameKey: "modelIdeogram", blurbKey: "modelIdeogramBlurb", fb: "Portrait Render", fbB: "Best for products with text or logos." },
                  ] as Array<{ id: PhotoModel; nameKey: string; blurbKey: string; fb: string; fbB: string }>
                ).map((m) => {
                  const active = model === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        active ? "border-primary bg-primary/10" : "border-white/10 hover:border-white/25"
                      }`}
                    >
                      <div className={`text-sm font-bold ${active ? "text-primary" : "text-white"}`}>{tr(m.nameKey, m.fb)}</div>
                      <div className="mt-0.5 text-xs text-white/40">{tr(m.blurbKey, m.fbB)}</div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                {(
                  [
                    { id: "1080:1080", labelKey: "ratioSquare", fb: "Square 1:1" },
                    { id: "1080:1920", labelKey: "ratioStory", fb: "Story 9:16" },
                  ] as Array<{ id: PhotoRatio; labelKey: string; fb: string }>
                ).map((r) => (
                  <button key={r.id} onClick={() => setRatio(r.id)} className={chipClass(ratio === r.id)}>
                    {tr(r.labelKey, r.fb)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* error */}
        {error && (
          <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* generate */}
        <button
          onClick={() => void startGeneration()}
          disabled={generating || uploading}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shirt className="h-4 w-4" />}
          {generating
            ? tr("generating", "Shooting your product…")
            : `${tr("generate", "Generate photo")} · ${tr("credits", "{n} Visual Bucs", { n: creditCost.toLocaleString("en-US") })}`}
        </button>

        {/* result */}
        {result && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-primary/25">
            <img src={result.url} alt={tr("resultAlt", "Generated product photo")} className="w-full object-cover" />
            <div className="flex items-center justify-between gap-3 bg-black/60 px-4 py-3">
              <span className="text-sm font-bold text-white">{tr("resultTitle", "Your product photo")}</span>
              <div className="flex gap-2">
                <a
                  href={result.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-xs font-bold text-white/70 hover:border-primary/40 hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" /> {tr("download", "Download")}
                </a>
                {onGenerated && (
                  <button
                    onClick={() => onGenerated?.(result.url, result.path)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-4 py-2 text-xs font-black text-black hover:brightness-110"
                  >
                    <Check className="h-3.5 w-3.5" /> {tr("usePhoto", "Use this photo")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductPhotoStudio;
