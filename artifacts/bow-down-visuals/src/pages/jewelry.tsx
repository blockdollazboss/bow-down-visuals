import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Upload, Sparkles, Loader2, Download, CheckCircle2, ArrowRight, ArrowLeft,
  Gem, Shirt, MessageCircle, X, FileBox, Calculator, Factory, Nfc,
  AlertTriangle, RefreshCw, Info, ChevronRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Logo-to-Luxury Studio ───────────────────────────────────────────────
   One-stop guided pipeline: upload logo → AI design → preview →
   manufacturing files (STL) → cost estimate → get it made → NFC setup.
   Every step flows into the next — no dead ends. */

const STEPS = [
  { key: "logo", labelKey: "jewelry.stepLogo", icon: Upload },
  { key: "design", labelKey: "jewelry.stepDesign", icon: Sparkles },
  { key: "preview", labelKey: "jewelry.stepPreview", icon: Gem },
  { key: "files", labelKey: "jewelry.stepFiles", icon: FileBox },
  { key: "estimate", labelKey: "jewelry.stepEstimate", icon: Calculator },
  { key: "make", labelKey: "jewelry.stepMake", icon: Factory },
  { key: "nfc", labelKey: "jewelry.stepNfc", icon: Nfc },
] as const;

interface Catalog {
  previewCreditCost: number;
  stlCreditCost: number;
  consultCreditCost: number;
  pieces: Record<string, { label: string }>;
  metals: Record<string, { label: string }>;
  stones: Record<string, { label: string }>;
  styles: Record<string, { label: string }>;
  apparel: Record<string, { label: string }>;
  decoMethods: Record<string, { label: string }>;
  defaults: {
    jewelry: JewelryOpts;
    apparel: ApparelOpts;
  };
}

interface JewelryOpts {
  piece: string; metal: string; stone: string; style: string;
  nfc: boolean; nfcUrl: string; notes: string;
}
interface ApparelOpts {
  product: string; deco: string; color: string; notes: string;
}

interface EstimateLine { label: string; lowUSD: number; highUSD: number; note: string }
interface Estimate {
  lines: EstimateLine[];
  totalLowUSD: number; totalHighUSD: number;
  weightG: number; stoneCount: number;
  turnaroundWeeks: [number, number];
  disclaimer: string;
}

interface GuideSection { title: string; body: string }

const money = (n: number) => "$" + Math.round(n).toLocaleString();

export default function JewelryStudio() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<"jewelry" | "apparel">("jewelry");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [jOpts, setJOpts] = useState<JewelryOpts>({
    piece: "diamond-pendant", metal: "yellow-14k", stone: "diamond",
    style: "iced-out", nfc: true, nfcUrl: "", notes: "",
  });
  const [aOpts, setAOpts] = useState<ApparelOpts>({
    product: "t-shirt", deco: "print", color: "Black", notes: "",
  });
  const [qty, setQty] = useState(24);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [stlInfo, setStlInfo] = useState<{
    url: string; facetCount: number; volumeMm3: number; weightG: number;
    metal: string; widthMm: number; heightMm: number; nfcPocket: boolean; pieceNote: string;
  } | null>(null);
  const [stlBusy, setStlBusy] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [guide, setGuide] = useState<GuideSection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [consultOpen, setConsultOpen] = useState(false);
  const [consultMsgs, setConsultMsgs] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [consultInput, setConsultInput] = useState("");
  const [consultBusy, setConsultBusy] = useState(false);
  const consultEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* Load public catalog + guide once. */
  useEffect(() => {
    fetch("/api/jewelry/status").then((r) => r.json()).then((d) => {
      setCatalog(d);
      if (d.defaults) {
        setJOpts(d.defaults.jewelry);
        setAOpts(d.defaults.apparel);
      }
    }).catch(() => {});
    fetch("/api/jewelry/guide").then((r) => r.json()).then((d) => setGuide(d.sections ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    consultEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consultMsgs, consultOpen]);

  const authed = async () => {
    const token = await getAccessToken();
    return { Authorization: `Bearer ${token}` };
  };

  const handleOutOfCredits = () => {
    setOutOfCredits(true);
    void refreshProfile();
  };

  /* ─── Step 1: logo upload ─── */
  const onLogoPicked = (f: File | undefined) => {
    if (!f) return;
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
    setPreviewUrl(null);
    setStlInfo(null);
    setEstimate(null);
  };

  /* ─── Step 3: AI preview (paid) ─── */
  async function generatePreview() {
    if (!logoFile || previewBusy) return;
    setPreviewBusy(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const fd = new FormData();
      fd.append("logo", logoFile);
      fd.append("category", category);
      const opts = category === "jewelry" ? jOpts : aOpts;
      for (const [k, v] of Object.entries(opts)) fd.append(k, String(v));
      const res = await confirmedFetch("/api/jewelry/design", {
        method: "POST", headers: await authed(), body: fd,
      });
      if (!res) return;
      const data = await res.json();
      if (res.status === 402) { handleOutOfCredits(); return; }
      if (!res.ok) throw new Error(data.error || t("jewelry.previewFailed"));
      setPreviewUrl(data.url);
      void refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jewelry.previewFailed"));
    } finally {
      setPreviewBusy(false);
    }
  }

  /* ─── Step 4: STL export (paid, jewelry only) ─── */
  async function exportSTL() {
    if (!logoFile || stlBusy || category !== "jewelry") return;
    setStlBusy(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const fd = new FormData();
      fd.append("logo", logoFile);
      fd.append("category", "jewelry");
      for (const [k, v] of Object.entries(jOpts)) fd.append(k, String(v));
      const res = await confirmedFetch("/api/jewelry/export-stl", {
        method: "POST", headers: await authed(), body: fd,
      });
      if (!res) return;
      const data = await res.json();
      if (res.status === 402) { handleOutOfCredits(); return; }
      if (!res.ok) throw new Error(data.error || t("jewelry.stlFailed"));
      setStlInfo(data);
      void refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jewelry.stlFailed"));
    } finally {
      setStlBusy(false);
    }
  }

  /* ─── Step 5: estimate (free, deterministic) ─── */
  async function loadEstimate() {
    if (estimateBusy) return;
    setEstimateBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jewelry/estimate", {
        method: "POST",
        headers: { ...(await authed()), "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          options: category === "jewelry" ? jOpts : aOpts,
          weightG: stlInfo?.weightG,
          qty,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("jewelry.estimateFailed"));
      setEstimate(data.estimate);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jewelry.estimateFailed"));
    } finally {
      setEstimateBusy(false);
    }
  }

  useEffect(() => {
    if (step === 4 && user) void loadEstimate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /* ─── Consultant chat (paid per message) ─── */
  async function sendConsult() {
    const msg = consultInput.trim();
    if (!msg || consultBusy) return;
    setConsultInput("");
    setConsultMsgs((m) => [...m, { role: "user", content: msg }]);
    setConsultBusy(true);
    try {
      const res = await fetch("/api/jewelry/consult", {
        method: "POST",
        headers: { ...(await authed()), "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          history: consultMsgs.slice(-10),
          context: { category, jewelry: jOpts, apparel: aOpts },
        }),
      });
      const data = await res.json();
      if (res.status === 402) { handleOutOfCredits(); return; }
      if (!res.ok) throw new Error(data.error || t("jewelry.consultFailed"));
      setConsultMsgs((m) => [...m, { role: "assistant", content: data.reply }]);
      void refreshProfile();
    } catch {
      setConsultMsgs((m) => [...m, { role: "assistant", content: t("jewelry.consultFallback") }]);
    } finally {
      setConsultBusy(false);
    }
  }

  const go = (n: number) => {
    setError(null);
    setStep(Math.max(0, Math.min(STEPS.length - 1, n)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const canContinue = (): boolean => {
    if (step === 0) return !!logoFile;
    if (step === 2) return !!previewUrl;
    return true;
  };

  const goldBtn =
    "inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-400 px-6 py-3 font-bold text-black hover:from-yellow-400 hover:to-amber-300 disabled:opacity-50 transition";
  const ghostBtn =
    "inline-flex items-center gap-2 rounded-xl border border-yellow-500/30 px-5 py-3 text-yellow-200 hover:bg-yellow-500/10 transition";
  const card = "rounded-2xl border border-yellow-500/20 bg-black/60 p-5 backdrop-blur";

  const optGrid = "grid grid-cols-2 gap-2 sm:grid-cols-3";
  const optBtn = (active: boolean) =>
    `rounded-xl border px-3 py-2.5 text-left text-sm transition ${
      active
        ? "border-yellow-400 bg-yellow-500/15 text-yellow-100 shadow-[0_0_12px_rgba(234,179,8,0.25)]"
        : "border-white/10 bg-white/5 text-zinc-300 hover:border-yellow-500/40"
    }`;

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      {/* Header */}
      <div className="border-b border-yellow-500/20 bg-gradient-to-b from-yellow-950/40 to-black px-4 py-8 text-center">
        <div className="mx-auto max-w-4xl">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-yellow-300">
            <Gem className="h-3.5 w-3.5" /> {t("jewelry.headerBadge")}
          </div>
          <h1 className="text-3xl font-black text-transparent sm:text-4xl bg-gradient-to-r from-yellow-200 via-amber-400 to-yellow-200 bg-clip-text">
            {t("jewelry.headerTitle")}
          </h1>
          <p className="mt-2 text-zinc-400">
            {t("jewelry.headerDesc")}
          </p>
        </div>
      </div>

      {/* Stepper */}
      <div className="sticky top-0 z-20 border-b border-yellow-500/15 bg-black/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-4 py-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <button
                key={s.key}
                onClick={() => i < step && go(i)}
                disabled={i > step}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  active
                    ? "bg-yellow-500/20 text-yellow-200"
                    : done
                      ? "text-yellow-500 hover:bg-yellow-500/10"
                      : "text-zinc-600"
                }`}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                <span className="hidden sm:inline">{i + 1}. {t(s.labelKey)}</span>
                <span className="sm:hidden">{i + 1}</span>
                {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-zinc-700" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {outOfCredits && (
          <div className="mb-4"><OutOfCredits onClose={() => setOutOfCredits(false)} /></div>
        )}

        {/* ── STEP 1: LOGO ── */}
        {step === 0 && (
          <div className={`${card} mx-auto max-w-2xl text-center`}>
            <h2 className="text-xl font-bold text-yellow-200">{t("jewelry.dropLogo")}</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t("jewelry.logoHint")}
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="mx-auto mt-6 flex h-56 w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-yellow-500/40 bg-yellow-500/5 transition hover:border-yellow-400 hover:bg-yellow-500/10"
            >
              {logoPreview ? (
                <img src={logoPreview} alt={t("jewelry.uploadedLogoAlt")} className="max-h-48 max-w-full object-contain" />
              ) : (
                <>
                  <Upload className="h-10 w-10 text-yellow-500" />
                  <span className="text-sm text-zinc-300">{t("jewelry.uploadLogo")}</span>
                  <span className="text-xs text-zinc-500">{t("jewelry.uploadFormats")}</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => onLogoPicked(e.target.files?.[0])}
            />
            {logoPreview && (
              <button onClick={() => fileRef.current?.click()} className="mt-3 text-sm text-yellow-400 hover:underline">
                {t("jewelry.chooseDifferent")}
              </button>
            )}

            <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-zinc-400">{t("jewelry.whatMaking")}</h3>
            <div className="mx-auto mt-3 grid max-w-md grid-cols-2 gap-3">
              <button onClick={() => setCategory("jewelry")} className={optBtn(category === "jewelry") + " !p-4 text-center"}>
                <Gem className="mx-auto mb-1 h-6 w-6 text-yellow-400" />
                <div className="font-bold">{t("jewelry.jewelry")}</div>
                <div className="text-xs text-zinc-500">{t("jewelry.jewelryBlurb")}</div>
              </button>
              <button onClick={() => setCategory("apparel")} className={optBtn(category === "apparel") + " !p-4 text-center"}>
                <Shirt className="mx-auto mb-1 h-6 w-6 text-yellow-400" />
                <div className="font-bold">{t("jewelry.apparel")}</div>
                <div className="text-xs text-zinc-500">{t("jewelry.apparelBlurb")}</div>
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: DESIGN ── */}
        {step === 1 && catalog && (
          <div className={card}>
            <h2 className="text-xl font-bold text-yellow-200">
              {t("jewelry.designTitle", { item: t(category === "jewelry" ? "jewelry.designPiece" : "jewelry.designGarment") })}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t("jewelry.designHint")}
            </p>

            {category === "jewelry" ? (
              <div className="mt-6 space-y-6">
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">{t("jewelry.piece")}</h3>
                  <div className={optGrid}>
                    {Object.entries(catalog.pieces).map(([k, v]) => (
                      <button key={k} onClick={() => setJOpts({ ...jOpts, piece: k })} className={optBtn(jOpts.piece === k)}>
                        <div className="font-semibold">{v.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">{t("jewelry.metal")}</h3>
                  <div className={optGrid}>
                    {Object.entries(catalog.metals).map(([k, v]) => (
                      <button key={k} onClick={() => setJOpts({ ...jOpts, metal: k })} className={optBtn(jOpts.metal === k)}>
                        <div className="font-semibold">{v.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">{t("jewelry.stones")}</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(catalog.stones).map(([k, v]) => (
                        <button key={k} onClick={() => setJOpts({ ...jOpts, stone: k })} className={optBtn(jOpts.stone === k)}>
                          <div className="font-semibold">{v.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">{t("jewelry.style")}</h3>
                    <div className="grid grid-cols-1 gap-2">
                      {Object.entries(catalog.styles).map(([k, v]) => (
                        <button key={k} onClick={() => setJOpts({ ...jOpts, style: k })} className={optBtn(jOpts.style === k)}>
                          <div className="font-semibold">{v.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-4">
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-yellow-100">
                        <Nfc className="h-4 w-4" /> {t("jewelry.nfcTitle")}
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {t("jewelry.nfcDesc")}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={jOpts.nfc}
                      onChange={(e) => setJOpts({ ...jOpts, nfc: e.target.checked })}
                      className="h-6 w-6 accent-yellow-500"
                    />
                  </label>
                  {jOpts.nfc && (
                    <input
                      value={jOpts.nfcUrl}
                      onChange={(e) => setJOpts({ ...jOpts, nfcUrl: e.target.value })}
                      placeholder="https://your-business-card.com/you"
                      className="mt-3 w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                    />
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
                    {t("jewelry.designNotes")} <span className="text-zinc-600">{t("jewelry.optional")}</span>
                  </h3>
                  <textarea
                    value={jOpts.notes}
                    onChange={(e) => setJOpts({ ...jOpts, notes: e.target.value })}
                    placeholder={t("jewelry.jewelryNotesPh")}
                    rows={2}
                    className="w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm placeholder:text-zinc-600"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">{t("jewelry.garment")}</h3>
                  <div className={optGrid}>
                    {Object.entries(catalog.apparel).map(([k, v]) => (
                      <button key={k} onClick={() => setAOpts({ ...aOpts, product: k })} className={optBtn(aOpts.product === k)}>
                        <div className="font-semibold">{v.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">{t("jewelry.decoration")}</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(catalog.decoMethods).map(([k, v]) => (
                        <button key={k} onClick={() => setAOpts({ ...aOpts, deco: k })} className={optBtn(aOpts.deco === k)}>
                          <div className="font-semibold">{v.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">{t("jewelry.garmentColor")}</h3>
                    <input
                      value={aOpts.color}
                      onChange={(e) => setAOpts({ ...aOpts, color: e.target.value })}
                      placeholder={t("jewelry.garmentColorPh")}
                      className="w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm placeholder:text-zinc-600"
                    />
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
                    {t("jewelry.unitsLabel")} <span className="text-zinc-600">{t("jewelry.unitsNote")}</span>
                  </h3>
                  <input
                    type="number" min={1} max={1000} value={qty}
                    onChange={(e) => setQty(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                    className="w-32 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
                    {t("jewelry.designNotes")} <span className="text-zinc-600">{t("jewelry.optional")}</span>
                  </h3>
                  <textarea
                    value={aOpts.notes}
                    onChange={(e) => setAOpts({ ...aOpts, notes: e.target.value })}
                    placeholder={t("jewelry.apparelNotesPh")}
                    rows={2}
                    className="w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm placeholder:text-zinc-600"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: PREVIEW ── */}
        {step === 2 && (
          <div className={`${card} mx-auto max-w-2xl text-center`}>
            <h2 className="text-xl font-bold text-yellow-200">{t("jewelry.aiPreview")}</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t("jewelry.previewDesc", { cost: catalog?.previewCreditCost ?? 2 })}
            </p>
            <div className="mx-auto mt-6 flex h-80 max-w-md items-center justify-center overflow-hidden rounded-2xl border border-yellow-500/25 bg-black/80">
              {previewBusy ? (
                <div className="flex flex-col items-center gap-3 text-yellow-300">
                  <Loader2 className="h-10 w-10 animate-spin" />
                  <span className="text-sm">{t("jewelry.casting")}</span>
                </div>
              ) : previewUrl ? (
                <img src={previewUrl} alt={t("jewelry.previewAlt")} className="h-full w-full object-cover" />
              ) : (
                <div className="px-6 text-sm text-zinc-500">
                  {t("jewelry.previewCtaHit")} <span className="font-semibold text-yellow-300">{t("jewelry.generatePreview")}</span> {t("jewelry.previewCtaRest", { material: t(category === "jewelry" ? "jewelry.goldWord" : "jewelry.merchWord") })}
                </div>
              )}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button onClick={generatePreview} disabled={previewBusy || !logoFile} className={goldBtn}>
                {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {previewUrl ? t("jewelry.regenerate") : t("jewelry.generatePreview")} ({catalog?.previewCreditCost ?? 2} VB)
              </button>
              {previewUrl && (
                <button onClick={generatePreview} disabled={previewBusy} className={ghostBtn}>
                  <RefreshCw className="h-4 w-4" /> {t("jewelry.tryAnother")}
                </button>
              )}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              {t("jewelry.previewNote")}
            </p>
          </div>
        )}

        {/* ── STEP 4: FILES ── */}
        {step === 3 && (
          <div className={`${card} mx-auto max-w-2xl`}>
            <h2 className="text-center text-xl font-bold text-yellow-200">{t("jewelry.mfgFile")}</h2>
            {category === "apparel" ? (
              <div className="mt-4 text-center">
                <Info className="mx-auto h-8 w-8 text-yellow-500" />
                <p className="mt-3 text-sm text-zinc-300">
                  {t("jewelry.apparelNoStl")} <span className="font-semibold text-yellow-200">{t("jewelry.apparelRender")}</span> {t("jewelry.apparelNoStlRest")}
                </p>
                {previewUrl && (
                  <a href={previewUrl} download="logo-apparel-preview.png" className={`${goldBtn} mt-5`}>
                    <Download className="h-4 w-4" /> {t("jewelry.downloadPrint")}
                  </a>
                )}
              </div>
            ) : (
              <div className="mt-4 text-center">
                <p className="text-sm text-zinc-400">
                  {t("jewelry.stlDescription", { nfc: jOpts.nfc ? t("jewelry.stlNfcCavity") : "", cost: catalog?.stlCreditCost ?? 4 })}
                </p>
                {!stlInfo ? (
                  <button onClick={exportSTL} disabled={stlBusy || !logoFile} className={`${goldBtn} mt-5`}>
                    {stlBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBox className="h-4 w-4" />}
                    {stlBusy ? t("jewelry.buildingStl") : t("jewelry.exportStl", { cost: catalog?.stlCreditCost ?? 4 })}
                  </button>
                ) : (
                  <div className="mt-5 rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-5 text-left">
                    <div className="flex items-center gap-2 font-semibold text-yellow-100">
                      <CheckCircle2 className="h-5 w-5 text-green-400" /> {t("jewelry.stlReady")}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">{t("jewelry.facets")}</div><div className="font-bold">{stlInfo.facetCount.toLocaleString()}</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">{t("jewelry.size")}</div><div className="font-bold">{stlInfo.widthMm} × {stlInfo.heightMm} mm</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">{t("jewelry.estWeight")}</div><div className="font-bold">{stlInfo.weightG} g {stlInfo.metal.split(" ")[0]}</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">{t("jewelry.nfcCavity")}</div><div className="font-bold">{stlInfo.nfcPocket ? t("jewelry.nfcYes") : t("jewelry.nfcNo")}</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">{t("jewelry.metal")}</div><div className="font-bold">{stlInfo.metal}</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">{t("jewelry.format")}</div><div className="font-bold">{t("jewelry.binaryStl")}</div></div>
                    </div>
                    <p className="mt-3 text-xs text-zinc-400">{stlInfo.pieceNote}</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <a href={stlInfo.url} download="logo-pendant.stl" className={goldBtn}>
                        <Download className="h-4 w-4" /> {t("jewelry.downloadStl")}
                      </a>
                      <button onClick={exportSTL} disabled={stlBusy} className={ghostBtn}>
                        <RefreshCw className="h-4 w-4" /> {t("jewelry.rebuild")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 5: ESTIMATE ── */}
        {step === 4 && (
          <div className={`${card} mx-auto max-w-2xl`}>
            <h2 className="text-center text-xl font-bold text-yellow-200">{t("jewelry.costTitle")}</h2>
            <p className="mt-1 text-center text-sm text-zinc-400">
              {t("jewelry.costHint")}
            </p>
            {estimateBusy && (
              <div className="mt-6 flex items-center justify-center gap-2 text-yellow-300">
                <Loader2 className="h-5 w-5 animate-spin" /> {t("jewelry.crunching")}
              </div>
            )}
            {estimate && !estimateBusy && (
              <div className="mt-5">
                <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-5 text-center">
                  <div className="text-xs uppercase tracking-widest text-zinc-400">{t("jewelry.estimatedTotal")}</div>
                  <div className="mt-1 text-3xl font-black text-yellow-300">
                    {money(estimate.totalLowUSD)} – {money(estimate.totalHighUSD)}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {t("jewelry.turnaround", { low: estimate.turnaroundWeeks[0], high: estimate.turnaroundWeeks[1] })}
                    {category === "apparel" && <> · {t("jewelry.units", { qty })}</>}
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {estimate.lines.map((l) => (
                    <div key={l.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-zinc-100">{l.label}</span>
                        <span className="font-bold text-yellow-300">{money(l.lowUSD)} – {money(l.highUSD)}</span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">{l.note}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200/90">
                  ⚠️ {estimate.disclaimer}
                </p>
                <button onClick={loadEstimate} className={`${ghostBtn} mt-4 w-full justify-center`}>
                  <RefreshCw className="h-4 w-4" /> {t("jewelry.recalculate")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 6: GET IT MADE ── */}
        {step === 5 && (
          <div className={card}>
            <h2 className="text-xl font-bold text-yellow-200">{t("jewelry.getItMade")}</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {t("jewelry.getItMadeDesc")}
            </p>
            <div className="mt-5 space-y-3">
              <Link
                href="/jewelry-shop"
                className="flex items-center justify-between gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 transition hover:bg-yellow-500/20"
              >
                <div>
                  <div className="text-sm font-bold text-yellow-200">{t("jewelry.ratherUs")}</div>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {t("jewelry.ratherUsDesc")}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-yellow-300" />
              </Link>
              {guide
                .filter((s) =>
                  category === "jewelry" ? !s.title.includes("Apparel") : s.title.includes("Apparel"),
                )
                .map((s) => (
                  <details key={s.title} className="group rounded-xl border border-white/10 bg-white/[0.03] open:border-yellow-500/30">
                    <summary className="flex cursor-pointer items-center justify-between gap-2 p-4 text-sm font-semibold text-yellow-100">
                      {s.title}
                      <ChevronRight className="h-4 w-4 shrink-0 transition group-open:rotate-90" />
                    </summary>
                    <p className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-zinc-300">{s.body}</p>
                  </details>
                ))}
            </div>
          </div>
        )}

        {/* ── STEP 7: NFC SETUP ── */}
        {step === 6 && (
          <div className={`${card} mx-auto max-w-2xl`}>
            {category === "apparel" ? (
              <div className="text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-green-400" />
                <h2 className="mt-3 text-xl font-bold text-yellow-200">{t("jewelry.doneTitle")}</h2>
                <p className="mt-2 text-sm text-zinc-300">
                  {t("jewelry.doneDesc", { product: aOpts.product })}
                </p>
                <button onClick={() => go(0)} className={`${goldBtn} mt-5`}>
                  <RefreshCw className="h-4 w-4" /> {t("jewelry.startNew")}
                </button>
              </div>
            ) : (
              <div>
                <h2 className="text-center text-xl font-bold text-yellow-200">{t("jewelry.nfcTitle")}</h2>
                <p className="mt-1 text-center text-sm text-zinc-400">
                  {t("jewelry.nfcSetupDesc", { verb: t(jOpts.nfc ? "jewelry.nfcHas" : "jewelry.nfcCanHave") })}
                </p>
                {!jOpts.nfc && (
                  <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200/90">
                    {t("jewelry.nfcOffNote")}
                  </p>
                )}
                <ol className="mt-5 space-y-3">
                  {[
                    { titleKey: "jewelry.nfcBuyTag", desc: t("jewelry.nfcBuyTagDesc") },
                    { titleKey: "jewelry.nfcSetLink", desc: t("jewelry.nfcSetLinkDesc", { chosen: jOpts.nfcUrl ? t("jewelry.nfcYouChose", { url: jOpts.nfcUrl }) : t("jewelry.nfcAddUrl") }) },
                    { titleKey: "jewelry.nfcProgram", desc: t("jewelry.nfcProgramDesc") },
                    { titleKey: "jewelry.nfcLock", desc: t("jewelry.nfcLockDesc") },
                    { titleKey: "jewelry.nfcSeat", desc: t("jewelry.nfcSeatDesc") },
                  ].map((s, i) => (
                    <li key={s.titleKey} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-yellow-500/20 text-sm font-bold text-yellow-300">{i + 1}</span>
                      <div>
                        <div className="text-sm font-semibold text-zinc-100">{t(s.titleKey)}</div>
                        <p className="mt-1 text-sm text-zinc-400">{s.desc}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-6 rounded-xl border border-green-500/30 bg-green-950/30 p-5 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-green-400" />
                  <h3 className="mt-2 font-bold text-green-200">{t("jewelry.pipelineComplete")}</h3>
                  <p className="mt-1 text-sm text-zinc-300">
                    {t("jewelry.pipelineDesc")}
                  </p>
                  <button onClick={() => go(0)} className={`${goldBtn} mt-4`}>
                    <RefreshCw className="h-4 w-4" /> {t("jewelry.startNew")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Nav */}
        <div className="mt-8 flex items-center justify-between">
          <button onClick={() => go(step - 1)} disabled={step === 0} className={ghostBtn + " disabled:opacity-30"}>
            <ArrowLeft className="h-4 w-4" /> {t("jewelry.back")}
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => go(step + 1)} disabled={!canContinue()} className={goldBtn + " disabled:opacity-30"}>
              {step === 0 && !logoFile ? t("jewelry.uploadToContinue")
                : step === 2 && !previewUrl ? t("jewelry.previewToContinue")
                : <>{t("jewelry.continue")} <ArrowRight className="h-4 w-4" /></>}
            </button>
          ) : (
            <div className="text-sm text-zinc-500"> {t("jewelry.kingShark")}</div>
          )}
        </div>
      </div>

      {/* Consultant floating button + drawer */}
      <button
        onClick={() => setConsultOpen(true)}
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 text-black shadow-[0_0_24px_rgba(234,179,8,0.5)] transition hover:scale-105"
        title={t("jewelry.consultTitleAttr")}
      >
        <MessageCircle className="h-6 w-6" />
      </button>
      {consultOpen && (
        <div className="fixed bottom-24 right-6 z-30 flex h-[480px] w-[calc(100vw-3rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-yellow-500/30 bg-zinc-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-yellow-500/20 bg-yellow-500/10 px-4 py-3">
            <div>
              <div className="text-sm font-bold text-yellow-200"> {t("jewelry.consultName")}</div>
              <div className="text-xs text-zinc-500">{t("jewelry.consultCost", { cost: catalog?.consultCreditCost ?? 1 })}</div>
            </div>
            <button onClick={() => setConsultOpen(false)} className="text-zinc-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {consultMsgs.length === 0 && (
              <p className="text-sm text-zinc-500">
                {t("jewelry.consultIntro")}
              </p>
            )}
            {consultMsgs.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-yellow-500/20 text-yellow-100" : "bg-white/5 text-zinc-200"}`}>
                {m.content}
              </div>
            ))}
            {consultBusy && <div className="text-sm text-zinc-500"><Loader2 className="inline h-4 w-4 animate-spin" /> {t("jewelry.thinking")}</div>}
            <div ref={consultEndRef} />
          </div>
          <div className="flex gap-2 border-t border-yellow-500/20 p-3">
            <input
              value={consultInput}
              onChange={(e) => setConsultInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendConsult()}
              placeholder={t("jewelry.consultPlaceholder")}
              className="flex-1 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm placeholder:text-zinc-600"
            />
            <button onClick={sendConsult} disabled={consultBusy || !consultInput.trim()} className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-bold text-black disabled:opacity-50">
              {t("jewelry.send")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
