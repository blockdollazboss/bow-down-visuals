import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Calculator, CheckCircle2, Download, FileBox, Gem, Loader2, MessageCircle,
  Nfc, RefreshCw, Shirt, Sparkles, Upload, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { NativeCard } from "./NativeCard";
import { NativeLoadingState, NativeErrorState } from "./NativeStates";
import {
  JEWELRY_HANDOFF_KEY,
  JEWELRY_SHOP_PATH,
  buildJewelryConsultPayload,
  buildJewelryEstimatePayload,
  buildJewelryShopHandoff,
  guideSectionsFor,
  jewelryFormFields,
  parseJewelryCatalog,
  parseJewelryConsultReply,
  parseJewelryDesignUrl,
  parseJewelryEstimate,
  parseJewelryGuide,
  parseJewelryStl,
  type ApparelOpts,
  type JewelryCatalog,
  type JewelryCategory,
  type JewelryEstimate,
  type JewelryGuideSection,
  type JewelryOpts,
  type JewelryStlInfo,
} from "@/lib/world/jewelry-bench";

/* ─── The Jewelry Bench (Stack-100 #74) ──────────────────────────────
   The Branding Atelier's missing desk: the Logo-to-Luxury Studio's
   bench, complete in-world on the studio's own rails — logo (upload
   or a logo already made, from the hub) → design picks from the
   rail's catalog → AI preview (200 VB) → manufacturing STL (400 VB,
   jewelry only) → free estimate → get-it-made guide → NFC setup →
   the consultant (100 VB a message). Every charge is confirmed first
   through useConfirmedApi, exactly the website's confirmation law;
   prices are read from GET /api/jewelry/status, never invented. The
   one step that stays a handoff is the one the website itself hands
   off: ordering a finished piece lives in the Jewelry Shop — the
   bench writes the page's own localStorage handoff and points there. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

const money = (n: number) => "$" + Math.round(n).toLocaleString();

export function JewelryBench({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { project } = useHubProject();
  const hubLogos = (project.assets ?? []).filter((a) => a.kind === "image" && a.meta?.["logo"] === "true");

  const [catalog, setCatalog] = useState<JewelryCatalog | null>(null);
  const [catalogState, setCatalogState] = useState<"loading" | "failed" | "ready">("loading");
  const [catalogTick, setCatalogTick] = useState(0);
  const [guide, setGuide] = useState<JewelryGuideSection[]>([]);

  const [category, setCategory] = useState<JewelryCategory>("jewelry");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [jOpts, setJOpts] = useState<JewelryOpts>({
    piece: "diamond-pendant", metal: "yellow-14k", stone: "diamond",
    style: "iced-out", nfc: true, nfcUrl: "", notes: "",
  });
  const [aOpts, setAOpts] = useState<ApparelOpts>({ product: "t-shirt", deco: "print", color: "Black", notes: "" });
  const [qty, setQty] = useState(24);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [stlInfo, setStlInfo] = useState<JewelryStlInfo | null>(null);
  const [stlBusy, setStlBusy] = useState(false);
  const [estimate, setEstimate] = useState<JewelryEstimate | null>(null);
  const [estimateBusy, setEstimateBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [consultOpen, setConsultOpen] = useState(false);
  const [consultMsgs, setConsultMsgs] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [consultInput, setConsultInput] = useState("");
  const [consultBusy, setConsultBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatalogState("loading");
      try {
        const res = await fetch("/api/jewelry/status");
        if (!res.ok) throw new Error("status");
        const parsed = parseJewelryCatalog((await res.json()) as unknown);
        if (cancelled) return;
        if (!parsed) throw new Error("catalog");
        setCatalog(parsed);
        if (parsed.defaults) {
          setJOpts(parsed.defaults.jewelry);
          setAOpts(parsed.defaults.apparel);
        }
        setCatalogState("ready");
      } catch {
        if (!cancelled) setCatalogState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogTick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/jewelry/guide");
        if (!res.ok) return;
        const sections = parseJewelryGuide((await res.json()) as unknown);
        if (!cancelled) setGuide(sections);
      } catch {
        /* guide is a bonus read — the bench works without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isGuest) {
    return (
      <NativeCard isLight={isLight}>
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          The Jewelry Bench works on your own account — guests can look around the palace, but this
          bench only opens for members.{" "}
          <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
            Sign in
          </Link>{" "}
          and the bench is yours, right here in the Atelier.
        </p>
      </NativeCard>
    );
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const goldBtn =
    "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50";
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;
  const optBtn = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
      active
        ? "border-[#d4af37] bg-[#d4af37]/15 " + strong
        : isLight
          ? "border-[#C9A84C]/30 bg-white/50 text-[#6B5B36] hover:border-[#d4af37]"
          : "border-white/10 bg-white/5 text-white/60 hover:border-[#d4af37]/50"
    }`;

  const onLogoPicked = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      setError("That logo is over 10 MB — pick a smaller file.");
      return;
    }
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
    setPreviewUrl(null);
    setStlInfo(null);
    setEstimate(null);
    setError(null);
  };

  const pickHubLogo = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      onLogoPicked(new File([blob], "logo.png", { type: blob.type || "image/png" }));
    } catch {
      setError("That logo couldn't be fetched — upload the file instead.");
    }
  };

  const buildForm = (): FormData | null => {
    if (!logoFile) return null;
    const fd = new FormData();
    fd.append("logo", logoFile);
    const opts = category === "jewelry" ? jOpts : aOpts;
    for (const [k, v] of jewelryFormFields(category, opts)) fd.append(k, v);
    return fd;
  };

  const generatePreview = async () => {
    const fd = buildForm();
    if (!fd || previewBusy || !catalog) return;
    setPreviewBusy(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/jewelry/design", {
        method: "POST",
        headers: await authHeaders(),
        overrideCost: catalog.previewCreditCost,
        overrideFeature: "Jewelry Design",
        body: fd,
      });
      if (!res) return; /* declined the confirm — nothing charged */
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setError("Out of Visual Bucs — top up and the bench is ready again.");
        return;
      }
      if (!res.ok) {
        setError(((data as { error?: string }).error) ?? "The preview couldn't be made — a failed make is not charged. Try again.");
        return;
      }
      const url = parseJewelryDesignUrl(data);
      if (!url) {
        setError("The bench answered without a preview. Try again.");
        return;
      }
      setPreviewUrl(url);
      refreshProfile();
    } catch {
      setError("The jewelry bench didn't answer. Try again.");
    } finally {
      setPreviewBusy(false);
    }
  };

  const exportStl = async () => {
    if (!logoFile || stlBusy || category !== "jewelry" || !catalog) return;
    const fd = new FormData();
    fd.append("logo", logoFile);
    for (const [k, v] of jewelryFormFields("jewelry", jOpts)) fd.append(k, v);
    setStlBusy(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/jewelry/export-stl", {
        method: "POST",
        headers: await authHeaders(),
        overrideCost: catalog.stlCreditCost,
        overrideFeature: "Export Jewelry STL",
        body: fd,
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setError("Out of Visual Bucs — top up and the bench is ready again.");
        return;
      }
      if (!res.ok) {
        setError(((data as { error?: string }).error) ?? "The manufacturing file couldn't be built. Try again.");
        return;
      }
      const info = parseJewelryStl(data);
      if (!info) {
        setError("The bench answered without a file. Try again.");
        return;
      }
      setStlInfo(info);
      refreshProfile();
    } catch {
      setError("The jewelry bench didn't answer. Try again.");
    } finally {
      setStlBusy(false);
    }
  };

  const loadEstimate = async () => {
    if (estimateBusy) return;
    setEstimateBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jewelry/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          buildJewelryEstimatePayload({
            category,
            opts: category === "jewelry" ? jOpts : aOpts,
            weightG: stlInfo?.weightG,
            qty,
          }),
        ),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("estimate");
      const parsed = parseJewelryEstimate(data);
      if (!parsed) throw new Error("estimate");
      setEstimate(parsed);
    } catch {
      setError("The estimate couldn't be worked out. Try again.");
    } finally {
      setEstimateBusy(false);
    }
  };

  const sendConsult = async () => {
    const msg = consultInput.trim();
    if (!msg || consultBusy || !catalog) return;
    setConsultInput("");
    const history = consultMsgs;
    setConsultMsgs((m) => [...m, { role: "user", content: msg }]);
    setConsultBusy(true);
    try {
      const res = await confirmedFetch("/api/jewelry/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        overrideCost: catalog.consultCreditCost,
        overrideFeature: "Jewelry Consult",
        body: JSON.stringify(
          buildJewelryConsultPayload({ message: msg, history, category, jewelry: jOpts, apparel: aOpts }),
        ),
      });
      if (!res) {
        setConsultMsgs((m) => m.slice(0, -1));
        setConsultInput(msg);
        return;
      }
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setConsultMsgs((m) => [...m, { role: "assistant", content: "Out of Visual Bucs — top up and the consultant is ready again." }]);
        return;
      }
      if (!res.ok) throw new Error("consult");
      const reply = parseJewelryConsultReply(data);
      setConsultMsgs((m) => [...m, { role: "assistant", content: reply ?? "My fins slipped — could you ask that again?" }]);
      refreshProfile();
    } catch {
      setConsultMsgs((m) => [...m, { role: "assistant", content: "The consultant didn't answer — a failed answer is not charged. Ask again." }]);
    } finally {
      setConsultBusy(false);
    }
  };

  const handToShop = () => {
    try {
      localStorage.setItem(
        JEWELRY_HANDOFF_KEY,
        JSON.stringify(buildJewelryShopHandoff({ category, jewelry: jOpts, apparel: aOpts, estimate, at: Date.now() })),
      );
    } catch {
      /* storage unavailable — the shop still opens */
    }
  };

  return (
    <div className="space-y-3" data-testid="world-jewelry-bench">
      {catalogState === "loading" ? (
        <NativeCard isLight={isLight} title="Jewelry bench">
          <NativeLoadingState isLight={isLight} message="Opening the jewelry bench…" />
        </NativeCard>
      ) : catalogState === "failed" || !catalog ? (
        <NativeCard isLight={isLight} title="Jewelry bench">
          <NativeErrorState
            isLight={isLight}
            message="The jewelry bench wouldn't open — the studio's catalog didn't answer."
            onRetry={() => setCatalogTick((n) => n + 1)}
          />
        </NativeCard>
      ) : (
        <>
          {error ? (
            <p className="px-1 text-xs font-semibold text-red-400" data-testid="world-jewelry-error">{error}</p>
          ) : null}

          <NativeCard isLight={isLight} title="1 · Your logo">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#d4af37]/40 bg-[#d4af37]/5 px-4 py-6 transition hover:border-[#d4af37]"
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="Your logo" className="max-h-36 object-contain" />
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-[#d4af37]" />
                    <span className={`text-sm ${strong}`}>Upload your logo</span>
                    <span className={`text-xs ${muted}`}>PNG, JPG or WebP, up to 10 MB</span>
                  </>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                data-testid="world-jewelry-logo-upload"
                onChange={(e) => onLogoPicked(e.target.files?.[0])}
              />
              {hubLogos.length > 0 && !logoPreview ? (
                <div>
                  <p className={`mb-2 text-[11px] font-bold uppercase tracking-wider ${muted}`}>Or use a logo you already made</p>
                  <div className="flex flex-wrap gap-2">
                    {hubLogos.slice(0, 6).map((l) => (
                      <button key={l.id} type="button" onClick={() => void pickHubLogo(l.url)} className="h-14 w-14 overflow-hidden rounded-xl border border-[#d4af37]/40 transition hover:border-[#d4af37]" title={l.label}>
                        <img src={l.url} alt={l.label} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setCategory("jewelry")} className={`${optBtn(category === "jewelry")} text-center`} data-testid="world-jewelry-category-jewelry">
                  <Gem className="mx-auto mb-1 h-5 w-5 text-[#d4af37]" /> Jewelry
                </button>
                <button type="button" onClick={() => setCategory("apparel")} className={`${optBtn(category === "apparel")} text-center`} data-testid="world-jewelry-category-apparel">
                  <Shirt className="mx-auto mb-1 h-5 w-5 text-[#d4af37]" /> Apparel
                </button>
              </div>
            </div>
          </NativeCard>

          <NativeCard isLight={isLight} title="2 · Design it">
            {category === "jewelry" ? (
              <div className="space-y-3" data-testid="world-jewelry-design-jewelry">
                {([
                  ["pieces", "Piece", jOpts.piece, (v: string) => setJOpts({ ...jOpts, piece: v })],
                  ["metals", "Metal", jOpts.metal, (v: string) => setJOpts({ ...jOpts, metal: v })],
                  ["stones", "Stones", jOpts.stone, (v: string) => setJOpts({ ...jOpts, stone: v })],
                  ["styles", "Style", jOpts.style, (v: string) => setJOpts({ ...jOpts, style: v })],
                ] as const).map(([list, label, value, set]) => (
                  <div key={list}>
                    <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-wider ${muted}`}>{label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {catalog[list].map((o) => (
                        <button key={o.key} type="button" onClick={() => set(o.key)} className={optBtn(value === o.key)}>{o.label}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <label className="flex items-center justify-between gap-3 rounded-xl border border-[#d4af37]/25 px-3 py-2">
                  <span className={`inline-flex items-center gap-2 text-sm font-semibold ${strong}`}>
                    <Nfc className="h-4 w-4 text-[#d4af37]" /> NFC chip pocket
                  </span>
                  <input type="checkbox" checked={jOpts.nfc} onChange={(e) => setJOpts({ ...jOpts, nfc: e.target.checked })} className="h-5 w-5 accent-[#d4af37]" />
                </label>
                {jOpts.nfc ? (
                  <input aria-label="NFC link" className={inputCls} value={jOpts.nfcUrl} onChange={(e) => setJOpts({ ...jOpts, nfcUrl: e.target.value })} placeholder="The link the chip opens — https://your-business-card.com/you" />
                ) : null}
                <textarea aria-label="Design notes" className={inputCls} rows={2} value={jOpts.notes} onChange={(e) => setJOpts({ ...jOpts, notes: e.target.value })} placeholder="Design notes (optional)" />
              </div>
            ) : (
              <div className="space-y-3" data-testid="world-jewelry-design-apparel">
                {([
                  ["apparel", "Garment", aOpts.product, (v: string) => setAOpts({ ...aOpts, product: v })],
                  ["decoMethods", "Decoration", aOpts.deco, (v: string) => setAOpts({ ...aOpts, deco: v })],
                ] as const).map(([list, label, value, set]) => (
                  <div key={list}>
                    <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-wider ${muted}`}>{label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {catalog[list].map((o) => (
                        <button key={o.key} type="button" onClick={() => set(o.key)} className={optBtn(value === o.key)}>{o.label}</button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="grid gap-2 sm:grid-cols-2">
                  <input aria-label="Garment color" className={inputCls} value={aOpts.color} onChange={(e) => setAOpts({ ...aOpts, color: e.target.value })} placeholder="Garment color" />
                  <label className="block">
                    <span className={`mb-1 block text-[11px] font-bold uppercase tracking-wider ${muted}`}>Units for the estimate</span>
                    <input aria-label="Units" type="number" min={1} max={1000} className={inputCls} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
                  </label>
                </div>
                <textarea aria-label="Design notes" className={inputCls} rows={2} value={aOpts.notes} onChange={(e) => setAOpts({ ...aOpts, notes: e.target.value })} placeholder="Design notes (optional)" />
              </div>
            )}
          </NativeCard>

          <NativeCard isLight={isLight} title="3 · Preview & files">
            <div className="space-y-3">
              <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl border border-[#d4af37]/30 bg-black/60">
                {previewBusy ? (
                  <span className="inline-flex items-center gap-2 text-sm text-[#e8c86a]"><Loader2 className="h-5 w-5 animate-spin" /> Casting your preview…</span>
                ) : previewUrl ? (
                  <img src={previewUrl} alt="Your design preview" className="h-full w-full object-cover" />
                ) : (
                  <p className={`px-6 text-center text-sm ${muted}`}>Your preview stands here — generate it and see the piece before anyone casts it.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="world-jewelry-preview" onClick={() => void generatePreview()} disabled={previewBusy || !logoFile} className={goldBtn}>
                  <Sparkles className="h-4 w-4" /> {previewBusy ? "Casting…" : `${previewUrl ? "Regenerate" : "Generate"} preview — ${catalog.previewCreditCost} Visual Bucs`}
                </button>
                {category === "jewelry" ? (
                  <button type="button" data-testid="world-jewelry-stl" onClick={() => void exportStl()} disabled={stlBusy || !logoFile} className={goldBtn}>
                    <FileBox className="h-4 w-4" /> {stlBusy ? "Building…" : `Export manufacturing STL — ${catalog.stlCreditCost} Visual Bucs`}
                  </button>
                ) : null}
              </div>
              {!logoFile ? <p className={`text-xs ${muted}`}>Add your logo in step 1 first — the bench works from it.</p> : null}
              {category === "apparel" && previewUrl ? (
                <a href={previewUrl} download="logo-apparel-preview.png" className={goldBtn}>
                  <Download className="h-4 w-4" /> Download the print file
                </a>
              ) : null}
              {stlInfo ? (
                <div className="rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-3" data-testid="world-jewelry-stl-info">
                  <p className={`inline-flex items-center gap-2 text-sm font-bold ${strong}`}><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Manufacturing file ready</p>
                  <p className={`mt-1 text-xs ${muted}`}>
                    {stlInfo.facetCount.toLocaleString()} facets · {stlInfo.widthMm} × {stlInfo.heightMm} mm · {stlInfo.weightG} g {stlInfo.metal.split(" ")[0]} · NFC pocket {stlInfo.nfcPocket ? "carved" : "not carved"}
                  </p>
                  {stlInfo.pieceNote ? <p className={`mt-1 text-xs ${muted}`}>{stlInfo.pieceNote}</p> : null}
                  <a href={stlInfo.url} download="logo-pendant.stl" className={`${goldBtn} mt-2`}>
                    <Download className="h-4 w-4" /> Download STL
                  </a>
                </div>
              ) : null}
            </div>
          </NativeCard>

          <NativeCard isLight={isLight} title="4 · What it costs to make">
            <div className="space-y-3">
              <button type="button" data-testid="world-jewelry-estimate" onClick={() => void loadEstimate()} disabled={estimateBusy} className={goldBtn}>
                <Calculator className="h-4 w-4" /> {estimateBusy ? "Crunching…" : "Work out the estimate — free"}
              </button>
              {estimate ? (
                <div data-testid="world-jewelry-estimate-result">
                  <div className="rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/10 p-4 text-center">
                    <p className={`text-[11px] font-bold uppercase tracking-wider ${muted}`}>Estimated total</p>
                    <p className="mt-1 text-2xl font-black text-[#d4af37]">{money(estimate.totalLowUSD)} – {money(estimate.totalHighUSD)}</p>
                    <p className={`mt-1 text-xs ${muted}`}>
                      Turnaround {estimate.turnaroundWeeks[0]}–{estimate.turnaroundWeeks[1]} weeks{category === "apparel" ? ` · ${qty} units` : ""}
                    </p>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {estimate.lines.map((l) => (
                      <div key={l.label} className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                        <p className={`flex items-center justify-between text-sm ${strong}`}><span className="font-semibold">{l.label}</span><span className="font-bold text-[#d4af37]">{money(l.lowUSD)} – {money(l.highUSD)}</span></p>
                        {l.note ? <p className={`mt-0.5 text-xs ${muted}`}>{l.note}</p> : null}
                      </div>
                    ))}
                  </div>
                  {estimate.disclaimer ? <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{estimate.disclaimer}</p> : null}
                  <button type="button" onClick={() => void loadEstimate()} className={`mt-2 inline-flex items-center gap-1.5 text-xs font-bold ${strong}`}>
                    <RefreshCw className="h-3.5 w-3.5 text-[#d4af37]" /> Recalculate
                  </button>
                </div>
              ) : null}
            </div>
          </NativeCard>

          <NativeCard isLight={isLight} title="5 · Get it made & NFC">
            <div className="space-y-2">
              <p className={`text-sm ${muted}`}>
                Ordering a finished piece runs through the Jewelry Shop — your design and estimate
                travel with you, nothing is lost in transit.
              </p>
              <a href={JEWELRY_SHOP_PATH} target="_blank" rel="noreferrer" onClick={handToShop} data-testid="world-jewelry-shop-handoff" className={goldBtn}>
                Carry this design to the Jewelry Shop
              </a>
              {guideSectionsFor(guide, category).map((s) => (
                <details key={s.title} className={`rounded-xl border ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                  <summary className={`cursor-pointer px-3 py-2 text-sm font-semibold ${strong}`}>{s.title}</summary>
                  <p className={`whitespace-pre-line px-3 pb-3 text-sm leading-relaxed ${muted}`}>{s.body}</p>
                </details>
              ))}
              {category === "jewelry" ? (
                <div className="rounded-xl border border-[#d4af37]/25 px-3 py-2">
                  <p className={`inline-flex items-center gap-2 text-sm font-semibold ${strong}`}><Nfc className="h-4 w-4 text-[#d4af37]" /> NFC setup</p>
                  <ol className={`mt-1 list-decimal space-y-1 pl-5 text-sm ${muted}`}>
                    <li>Buy a blank NFC tag or chip sized for the pocket{jOpts.nfc ? " carved into your piece" : ""}.</li>
                    <li>Set its link{jOpts.nfcUrl ? <> — you chose <span className={strong}>{jOpts.nfcUrl}</span></> : " in step 2 above"}.</li>
                    <li>Program it with a free NFC writer app, then lock it if the tap should be permanent.</li>
                    <li>Seat the chip in the pocket — a tap now opens your link.</li>
                  </ol>
                </div>
              ) : null}
            </div>
          </NativeCard>

          <NativeCard isLight={isLight} title="Ask the bench consultant">
            <div className="space-y-2">
              <p className={`text-sm ${muted}`}>
                Metals, stones, sizing, care — the consultant knows the bench. {catalog.consultCreditCost} Visual Bucs a message, confirmed before it charges.
              </p>
              {!consultOpen ? (
                <button type="button" data-testid="world-jewelry-consult-open" onClick={() => setConsultOpen(true)} className={goldBtn}>
                  <MessageCircle className="h-4 w-4" /> Talk to the consultant
                </button>
              ) : (
                <div data-testid="world-jewelry-consult">
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {consultMsgs.length === 0 ? (
                      <p className={`text-sm ${muted}`}>Ask anything about the piece you're designing.</p>
                    ) : (
                      consultMsgs.map((m, i) => (
                        <div key={i} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-[#d4af37]/20 " + strong : isLight ? "bg-[#C9A84C]/10 text-[#2a1e07]" : "bg-white/5 text-white/80"}`}>
                          {m.content}
                        </div>
                      ))
                    )}
                    {consultBusy ? <p className={`inline-flex items-center gap-2 text-sm ${muted}`}><Loader2 className="h-4 w-4 animate-spin" /> Thinking…</p> : null}
                  </div>
                  <div className="flex gap-2">
                    <input
                      aria-label="Ask the consultant"
                      className={inputCls}
                      value={consultInput}
                      onChange={(e) => setConsultInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void sendConsult(); }}
                      placeholder="e.g. Will 14k hold a daily-wear pendant?"
                    />
                    <button type="button" data-testid="world-jewelry-consult-send" onClick={() => void sendConsult()} disabled={consultBusy || !consultInput.trim()} className={goldBtn}>
                      Send — {catalog.consultCreditCost} VB
                    </button>
                    <button type="button" aria-label="Close the consultant" onClick={() => setConsultOpen(false)} className="shrink-0 rounded-full border border-white/15 p-2 text-white/50 transition hover:text-white">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </NativeCard>
        </>
      )}
    </div>
  );
}
