import { useEffect, useRef, useState } from "react";
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
  { key: "logo", label: "Logo", icon: Upload },
  { key: "design", label: "Design", icon: Sparkles },
  { key: "preview", label: "Preview", icon: Gem },
  { key: "files", label: "Files", icon: FileBox },
  { key: "estimate", label: "Estimate", icon: Calculator },
  { key: "make", label: "Get it made", icon: Factory },
  { key: "nfc", label: "NFC setup", icon: Nfc },
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
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreviewUrl(data.url);
      void refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
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
      if (!res.ok) throw new Error(data.error || "STL export failed");
      setStlInfo(data);
      void refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "STL export failed");
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
      if (!res.ok) throw new Error(data.error || "Estimate failed");
      setEstimate(data.estimate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Estimate failed");
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
      if (!res.ok) throw new Error(data.error || "Consultant failed");
      setConsultMsgs((m) => [...m, { role: "assistant", content: data.reply }]);
      void refreshProfile();
    } catch {
      setConsultMsgs((m) => [...m, { role: "assistant", content: "My fins slipped — try that again? 🦈" }]);
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
            <Gem className="h-3.5 w-3.5" /> Logo-to-Luxury Studio
          </div>
          <h1 className="text-3xl font-black text-transparent sm:text-4xl bg-gradient-to-r from-yellow-200 via-amber-400 to-yellow-200 bg-clip-text">
            Your Logo. Real Jewelry. Real Clothing.
          </h1>
          <p className="mt-2 text-zinc-400">
            One guided pipeline: upload → AI design → preview → manufacturing files →
            cost estimate → get it made → NFC. No dead ends.
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
                <span className="hidden sm:inline">{i + 1}. {s.label}</span>
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
            <h2 className="text-xl font-bold text-yellow-200">Drop your logo</h2>
            <p className="mt-1 text-sm text-zinc-400">
              PNG with a transparent background gives the sharpest pendant. JPG works too.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="mx-auto mt-6 flex h-56 w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-yellow-500/40 bg-yellow-500/5 transition hover:border-yellow-400 hover:bg-yellow-500/10"
            >
              {logoPreview ? (
                <img src={logoPreview} alt="Uploaded logo" className="max-h-48 max-w-full object-contain" />
              ) : (
                <>
                  <Upload className="h-10 w-10 text-yellow-500" />
                  <span className="text-sm text-zinc-300">Click to upload your logo</span>
                  <span className="text-xs text-zinc-500">PNG · JPG · WebP — up to 10MB</span>
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
                Choose a different logo
              </button>
            )}

            <h3 className="mt-8 text-sm font-semibold uppercase tracking-widest text-zinc-400">What are we making?</h3>
            <div className="mx-auto mt-3 grid max-w-md grid-cols-2 gap-3">
              <button onClick={() => setCategory("jewelry")} className={optBtn(category === "jewelry") + " !p-4 text-center"}>
                <Gem className="mx-auto mb-1 h-6 w-6 text-yellow-400" />
                <div className="font-bold">Jewelry</div>
                <div className="text-xs text-zinc-500">Pendants, rings, chains…</div>
              </button>
              <button onClick={() => setCategory("apparel")} className={optBtn(category === "apparel") + " !p-4 text-center"}>
                <Shirt className="mx-auto mb-1 h-6 w-6 text-yellow-400" />
                <div className="font-bold">Apparel</div>
                <div className="text-xs text-zinc-500">Tees, hoodies, caps…</div>
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: DESIGN ── */}
        {step === 1 && catalog && (
          <div className={card}>
            <h2 className="text-xl font-bold text-yellow-200">
              Design your {category === "jewelry" ? "piece" : "garment"}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Pick every detail — the AI preview and the cost estimate follow your choices exactly.
            </p>

            {category === "jewelry" ? (
              <div className="mt-6 space-y-6">
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">Piece</h3>
                  <div className={optGrid}>
                    {Object.entries(catalog.pieces).map(([k, v]) => (
                      <button key={k} onClick={() => setJOpts({ ...jOpts, piece: k })} className={optBtn(jOpts.piece === k)}>
                        <div className="font-semibold">{v.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">Metal</h3>
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
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">Stones</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(catalog.stones).map(([k, v]) => (
                        <button key={k} onClick={() => setJOpts({ ...jOpts, stone: k })} className={optBtn(jOpts.stone === k)}>
                          <div className="font-semibold">{v.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">Style</h3>
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
                        <Nfc className="h-4 w-4" /> NFC smart chip
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        A cavity for an NTAG213/215 tag is carved into the pendant back.
                        Tap the piece → opens your business card.
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
                    Design notes <span className="text-zinc-600">(optional)</span>
                  </h3>
                  <textarea
                    value={jOpts.notes}
                    onChange={(e) => setJOpts({ ...jOpts, notes: e.target.value })}
                    placeholder="e.g. extra chunky bail, black enamel background behind the logo…"
                    rows={2}
                    className="w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm placeholder:text-zinc-600"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">Garment</h3>
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
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">Decoration</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(catalog.decoMethods).map(([k, v]) => (
                        <button key={k} onClick={() => setAOpts({ ...aOpts, deco: k })} className={optBtn(aOpts.deco === k)}>
                          <div className="font-semibold">{v.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">Garment color</h3>
                    <input
                      value={aOpts.color}
                      onChange={(e) => setAOpts({ ...aOpts, color: e.target.value })}
                      placeholder="Black"
                      className="w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm placeholder:text-zinc-600"
                    />
                  </div>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
                    How many units? <span className="text-zinc-600">(for bulk estimate)</span>
                  </h3>
                  <input
                    type="number" min={1} max={1000} value={qty}
                    onChange={(e) => setQty(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                    className="w-32 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-zinc-400">
                    Design notes <span className="text-zinc-600">(optional)</span>
                  </h3>
                  <textarea
                    value={aOpts.notes}
                    onChange={(e) => setAOpts({ ...aOpts, notes: e.target.value })}
                    placeholder="e.g. logo big across the chest, small gold text on the sleeve…"
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
            <h2 className="text-xl font-bold text-yellow-200">AI preview</h2>
            <p className="mt-1 text-sm text-zinc-400">
              A luxury product render of your design —{" "}
              <span className="font-semibold text-yellow-300">{catalog?.previewCreditCost ?? 2} credits</span> per render.
            </p>
            <div className="mx-auto mt-6 flex h-80 max-w-md items-center justify-center overflow-hidden rounded-2xl border border-yellow-500/25 bg-black/80">
              {previewBusy ? (
                <div className="flex flex-col items-center gap-3 text-yellow-300">
                  <Loader2 className="h-10 w-10 animate-spin" />
                  <span className="text-sm">Casting your piece in pixels…</span>
                </div>
              ) : previewUrl ? (
                <img src={previewUrl} alt="AI jewelry preview" className="h-full w-full object-cover" />
              ) : (
                <div className="px-6 text-sm text-zinc-500">
                  Hit <span className="font-semibold text-yellow-300">Generate preview</span> and watch
                  your logo turn to {category === "jewelry" ? "gold" : "merch"}.
                </div>
              )}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button onClick={generatePreview} disabled={previewBusy || !logoFile} className={goldBtn}>
                {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {previewUrl ? "Regenerate" : "Generate preview"} ({catalog?.previewCreditCost ?? 2} cr)
              </button>
              {previewUrl && (
                <button onClick={generatePreview} disabled={previewBusy} className={ghostBtn}>
                  <RefreshCw className="h-4 w-4" /> Try another
                </button>
              )}
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              The preview is an AI visualization — your manufacturing file is built from your exact logo geometry.
            </p>
          </div>
        )}

        {/* ── STEP 4: FILES ── */}
        {step === 3 && (
          <div className={`${card} mx-auto max-w-2xl`}>
            <h2 className="text-center text-xl font-bold text-yellow-200">Manufacturing file</h2>
            {category === "apparel" ? (
              <div className="mt-4 text-center">
                <Info className="mx-auto h-8 w-8 text-yellow-500" />
                <p className="mt-3 text-sm text-zinc-300">
                  For apparel there's no STL — your print file is the <span className="font-semibold text-yellow-200">AI preview render</span> from
                  the previous step (high-res PNG). Send it straight to your decorator, or ask the consultant
                  for the exact file specs your print shop needs.
                </p>
                {previewUrl && (
                  <a href={previewUrl} download="logo-apparel-preview.png" className={`${goldBtn} mt-5`}>
                    <Download className="h-4 w-4" /> Download print file
                  </a>
                )}
              </div>
            ) : (
              <div className="mt-4 text-center">
                <p className="text-sm text-zinc-400">
                  Your logo is converted into a real <span className="font-semibold text-yellow-200">binary STL</span> —
                  a 35mm medallion with your logo in raised relief, a chain bail
                  {jOpts.nfc ? ", and an NFC tag cavity in the back" : ""}.{" "}
                  <span className="font-semibold text-yellow-300">{catalog?.stlCreditCost ?? 4} credits</span>.
                </p>
                {!stlInfo ? (
                  <button onClick={exportSTL} disabled={stlBusy || !logoFile} className={`${goldBtn} mt-5`}>
                    {stlBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBox className="h-4 w-4" />}
                    {stlBusy ? "Building your STL…" : `Export STL (${catalog?.stlCreditCost ?? 4} cr)`}
                  </button>
                ) : (
                  <div className="mt-5 rounded-xl border border-yellow-500/25 bg-yellow-500/5 p-5 text-left">
                    <div className="flex items-center gap-2 font-semibold text-yellow-100">
                      <CheckCircle2 className="h-5 w-5 text-green-400" /> STL ready
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">Facets</div><div className="font-bold">{stlInfo.facetCount.toLocaleString()}</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">Size</div><div className="font-bold">{stlInfo.widthMm} × {stlInfo.heightMm} mm</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">Est. weight</div><div className="font-bold">{stlInfo.weightG} g {stlInfo.metal.split(" ")[0]}</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">NFC cavity</div><div className="font-bold">{stlInfo.nfcPocket ? "Yes — 25mm" : "No"}</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">Metal</div><div className="font-bold">{stlInfo.metal}</div></div>
                      <div className="rounded-lg bg-black/50 p-2"><div className="text-xs text-zinc-500">Format</div><div className="font-bold">Binary STL</div></div>
                    </div>
                    <p className="mt-3 text-xs text-zinc-400">{stlInfo.pieceNote}</p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <a href={stlInfo.url} download="logo-pendant.stl" className={goldBtn}>
                        <Download className="h-4 w-4" /> Download .stl
                      </a>
                      <button onClick={exportSTL} disabled={stlBusy} className={ghostBtn}>
                        <RefreshCw className="h-4 w-4" /> Rebuild
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
            <h2 className="text-center text-xl font-bold text-yellow-200">What will it cost?</h2>
            <p className="mt-1 text-center text-sm text-zinc-400">
              Instant estimate from your exact options — free, no credits.
            </p>
            {estimateBusy && (
              <div className="mt-6 flex items-center justify-center gap-2 text-yellow-300">
                <Loader2 className="h-5 w-5 animate-spin" /> Crunching the numbers…
              </div>
            )}
            {estimate && !estimateBusy && (
              <div className="mt-5">
                <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-5 text-center">
                  <div className="text-xs uppercase tracking-widest text-zinc-400">Estimated total</div>
                  <div className="mt-1 text-3xl font-black text-yellow-300">
                    {money(estimate.totalLowUSD)} – {money(estimate.totalHighUSD)}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {estimate.turnaroundWeeks[0]}–{estimate.turnaroundWeeks[1]} weeks typical turnaround
                    {category === "apparel" && <> · {qty} units</>}
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
                  <RefreshCw className="h-4 w-4" /> Recalculate with current options
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 6: GET IT MADE ── */}
        {step === 5 && (
          <div className={card}>
            <h2 className="text-xl font-bold text-yellow-200">Get it made</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Your files are ready. Here's exactly how to turn them into the real thing —
              and what to watch out for.
            </p>
            <div className="mt-5 space-y-3">
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
                <h2 className="mt-3 text-xl font-bold text-yellow-200">You're done! 🎉</h2>
                <p className="mt-2 text-sm text-zinc-300">
                  Your design, print file, cost estimate, and decorator guide are all above.
                  Send the print file to your decorator and your {aOpts.product} line is in motion.
                </p>
                <button onClick={() => go(0)} className={`${goldBtn} mt-5`}>
                  <RefreshCw className="h-4 w-4" /> Start a new design
                </button>
              </div>
            ) : (
              <div>
                <h2 className="text-center text-xl font-bold text-yellow-200">NFC setup — make it smart</h2>
                <p className="mt-1 text-center text-sm text-zinc-400">
                  Your pendant {jOpts.nfc ? "has" : "can have"} a tag cavity. Here's the 10-minute setup.
                </p>
                {!jOpts.nfc && (
                  <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-200/90">
                    You turned NFC off in the design step — flip it on there and re-export the STL
                    to add the tag cavity.
                  </p>
                )}
                <ol className="mt-5 space-y-3">
                  {[
                    { t: "Buy the tag", d: "NTAG213 or NTAG215 coin tag, 25mm diameter × ~1mm thick (~$1–3 on Amazon). NTAG215 holds more data — use it if your URL is long." },
                    { t: "Set your link", d: `Decide where the tap goes — your digital business card or profile. ${jOpts.nfcUrl ? `You chose: ${jOpts.nfcUrl}` : "Add your URL in the design step so it's saved with your project."} Short URLs work best.` },
                    { t: "Program it (free app)", d: "Install NFC Tools (iOS/Android) → Write → Add a record → URL → type your link → Write → hold phone to the tag. Test it: tap should open your link instantly." },
                    { t: "Lock it", d: "In NFC Tools, set the tag to read-only after programming so nobody can rewrite your pendant. (Optional but recommended.)" },
                    { t: "Seat it in the pendant", d: "Your jeweler seats the programmed tag into the back cavity during finishing and seals it with jeweler's epoxy. Mention it when you get quotes — it's ~$15–40 of labor." },
                  ].map((s, i) => (
                    <li key={s.t} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-yellow-500/20 text-sm font-bold text-yellow-300">{i + 1}</span>
                      <div>
                        <div className="text-sm font-semibold text-zinc-100">{s.t}</div>
                        <p className="mt-1 text-sm text-zinc-400">{s.d}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-6 rounded-xl border border-green-500/30 bg-green-950/30 p-5 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-green-400" />
                  <h3 className="mt-2 font-bold text-green-200">Pipeline complete 🎉</h3>
                  <p className="mt-1 text-sm text-zinc-300">
                    Logo → AI design → preview → STL file → cost estimate → manufacturer guide → NFC.
                    All without leaving this page.
                  </p>
                  <button onClick={() => go(0)} className={`${goldBtn} mt-4`}>
                    <RefreshCw className="h-4 w-4" /> Start a new design
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Nav */}
        <div className="mt-8 flex items-center justify-between">
          <button onClick={() => go(step - 1)} disabled={step === 0} className={ghostBtn + " disabled:opacity-30"}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => go(step + 1)} disabled={!canContinue()} className={goldBtn + " disabled:opacity-30"}>
              {step === 0 && !logoFile ? "Upload a logo to continue"
                : step === 2 && !previewUrl ? "Generate a preview to continue"
                : <>Continue <ArrowRight className="h-4 w-4" /></>}
            </button>
          ) : (
            <div className="text-sm text-zinc-500">🦈 The King Shark approves.</div>
          )}
        </div>
      </div>

      {/* Consultant floating button + drawer */}
      <button
        onClick={() => setConsultOpen(true)}
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 text-black shadow-[0_0_24px_rgba(234,179,8,0.5)] transition hover:scale-105"
        title="Ask the jewelry consultant"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
      {consultOpen && (
        <div className="fixed bottom-24 right-6 z-30 flex h-[480px] w-[calc(100vw-3rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-yellow-500/30 bg-zinc-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-yellow-500/20 bg-yellow-500/10 px-4 py-3">
            <div>
              <div className="text-sm font-bold text-yellow-200">🦈 Jewelry Consultant</div>
              <div className="text-xs text-zinc-500">{catalog?.consultCreditCost ?? 1} credit per message · knows your design</div>
            </div>
            <button onClick={() => setConsultOpen(false)} className="text-zinc-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {consultMsgs.length === 0 && (
              <p className="text-sm text-zinc-500">
                Ask me anything — which metal for your budget, how NFC tags work,
                what to ask a jeweler, print vs embroidery…
              </p>
            )}
            {consultMsgs.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-yellow-500/20 text-yellow-100" : "bg-white/5 text-zinc-200"}`}>
                {m.content}
              </div>
            ))}
            {consultBusy && <div className="text-sm text-zinc-500"><Loader2 className="inline h-4 w-4 animate-spin" /> thinking…</div>}
            <div ref={consultEndRef} />
          </div>
          <div className="flex gap-2 border-t border-yellow-500/20 p-3">
            <input
              value={consultInput}
              onChange={(e) => setConsultInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendConsult()}
              placeholder="Ask about metals, NFC, jewelers…"
              className="flex-1 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm placeholder:text-zinc-600"
            />
            <button onClick={sendConsult} disabled={consultBusy || !consultInput.trim()} className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-bold text-black disabled:opacity-50">
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
