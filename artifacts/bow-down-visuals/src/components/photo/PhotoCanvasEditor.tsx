import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Copy, ArrowUp, ArrowDown, Eye, EyeOff, Download, Loader2,
  Type, Square, Image as ImageIcon, Save, FolderOpen, Share2,
} from "lucide-react";
import {
  createPhotoCanvasDoc, makeImageLayer, makeTextLayer, makeShapeLayer,
  addLayer, removeLayer, duplicateLayer, reorderLayer, updateLayer, layerAtPoint,
  drawFlattenPlan, clampDevelop, recipeFromDevelop, parseDoc, serializeDoc,
  SAFE_FONTS, DEFAULT_DEVELOP,
  type PhotoCanvasDoc, type PhotoLayer, type ImageLayer, type TextLayer, type DevelopSettings,
} from "@/lib/photo-canvas";
import { ClipContextMenu } from "@/components/editor/ClipContextMenu";
import { buildPhotoLayerContextItems } from "@/lib/photo-context-menu";

/**
 * PhotoCanvasEditor — the Photo desk as a real editor (Stack 7):
 * layered canvas (image/text/shape), editable text layers, develop
 * sliders, server multi-recipe export, batch look-sync and preset
 * packs. Editing is free; the canvas preview and the export share the
 * same layer model/flatten plan (geometry, order, text identical;
 * color develop is applied server-side at export).
 */

const LS_KEY = "bdv-photo-canvas-doc-v1";

const DEVELOP_SLIDERS: { key: keyof Omit<DevelopSettings, "crop">; label: string; min: number; max: number; step: number }[] = [
  { key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.05 },
  { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1 },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 },
  { key: "temperature", label: "White balance (temperature)", min: -100, max: 100, step: 1 },
  { key: "hue", label: "Hue", min: -180, max: 180, step: 1 },
  { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1 },
  { key: "lightness", label: "Lightness", min: -100, max: 100, step: 1 },
  { key: "rotateDeg", label: "Rotate (fine)", min: -45, max: 45, step: 0.5 },
];

interface ExportOutput { specId: string; ok: boolean; url: string | null; error: string | null; watermark: boolean }
interface BatchRow { imageUrl: string; ok: boolean; url: string | null; error: string | null }
interface PresetDto { id: string; name: string; recipe: { develop: DevelopSettings }; isPublic: boolean; shareSlug: string | null; storeProductId: string | null }

export function PhotoCanvasEditor() {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const [, setImgTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const [doc, setDoc] = useState<PhotoCanvasDoc>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      const parsed = saved ? parseDoc(saved) : null;
      if (parsed) return parsed;
    } catch { /* fresh doc */ }
    return createPhotoCanvasDoc(1280, 720);
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; layerId: string } | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [exportOutputs, setExportOutputs] = useState<ExportOutput[] | null>(null);
  const [batchInput, setBatchInput] = useState("");
  const [batchRows, setBatchRows] = useState<BatchRow[] | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetPublic, setPresetPublic] = useState(false);
  const [presets, setPresets] = useState<PresetDto[]>([]);

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const firstImage = doc.layers.find((l): l is ImageLayer => l.kind === "image") ?? null;
  const activeImage: ImageLayer | null = selected?.kind === "image" ? selected : firstImage;
  const recipe = useMemo(() => recipeFromDevelop(activeImage?.develop), [activeImage]);

  /* persist locally (house draft pattern: local mirror + server draft) */
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, serializeDoc(doc)); } catch { /* quota — server draft still works */ }
  }, [doc]);

  /* ── canvas render: load layer images, then draw the flatten plan ── */
  const ensureImage = useCallback((layer: ImageLayer) => {
    if (imagesRef.current.has(layer.id)) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imagesRef.current.set(layer.id, img); setImgTick((n) => n + 1); };
    img.onerror = () => {
      const plain = new Image();
      plain.onload = () => { imagesRef.current.set(layer.id, plain); setImgTick((n) => n + 1); };
      plain.src = layer.src;
    };
    img.src = layer.src;
  }, []);

  useEffect(() => {
    for (const l of doc.layers) if (l.kind === "image") ensureImage(l);
  }, [doc, ensureImage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawFlattenPlan(ctx as never, doc, imagesRef.current);
  }, [doc]);

  /* ── right-click menus: layer rows and the canvas itself share one
        menu (the model's own stack operations via the builder). */
  const openLayerMenu = (e: React.MouseEvent, layer: PhotoLayer) => {
    e.preventDefault();
    setSelectedId(layer.id);
    setMenu({ x: e.clientX, y: e.clientY, layerId: layer.id });
  };

  const onCanvasContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((e.clientX - rect.left) / rect.width) * doc.width;
    const y = ((e.clientY - rect.top) / rect.height) * doc.height;
    const layer = layerAtPoint(doc, x, y);
    if (!layer) return; // empty canvas: leave the browser menu alone
    openLayerMenu(e, layer);
  };

  const commitLayerDoc = (layerId: string) => (next: PhotoCanvasDoc) => {
    setDoc(next);
    if (!next.layers.some((l) => l.id === layerId)) {
      setSelectedId((cur) => (cur === layerId ? null : cur));
    }
  };

  const renderLayerMenu = () => {
    if (!menu) return null;
    const layer = doc.layers.find((l) => l.id === menu.layerId);
    if (!layer) return null;
    return (
      <ClipContextMenu
        x={menu.x}
        y={menu.y}
        onClose={() => setMenu(null)}
        testId="photo-layer-context-menu"
        items={buildPhotoLayerContextItems(doc, layer, commitLayerDoc(layer.id))}
      />
    );
  };

  const patch = (layer: PhotoLayer, p: Partial<PhotoLayer>) => setDoc((d) => updateLayer(d, layer.id, p));
  const patchTransform = (layer: PhotoLayer, p: Partial<PhotoLayer["transform"]>) =>
    patch(layer, { transform: { ...layer.transform, ...p } } as Partial<PhotoLayer>);

  function addPhotoFromFile(f: File | undefined) {
    if (!f) return;
    const url = URL.createObjectURL(f);
    setDoc((d) => addLayer(d, makeImageLayer(url, d, f.name || "Photo")));
  }
  function addPhotoFromUrl() {
    const url = imageUrlInput.trim();
    if (!url) return;
    setDoc((d) => addLayer(d, makeImageLayer(url, d, "Photo")));
    setImageUrlInput("");
  }

  /* ── export: PNG from the same canvas (client flatten) ── */
  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "photo-canvas.png";
    a.click();
  }

  /* ── export: server multi-recipe (develop applied per output) ── */
  async function serverMultiExport() {
    if (!firstImage || !/^https?:\/\//i.test(firstImage.src)) {
      toast({ title: "Server export needs a hosted photo", description: "Upload the photo first or paste a hosted image URL — local files can use the PNG download." });
      return;
    }
    setBusy("export"); setExportOutputs(null);
    try {
      const res = await confirmedFetch("/api/photo-editor/render-multi", {
        method: "POST", headers: { "Content-Type": "application/json" }, skipConfirm: true,
        body: JSON.stringify({
          imageUrl: firstImage.src, recipe,
          outputs: [
            { id: "wide-png", format: "png", width: 1920, height: 1080, watermark: false },
            { id: "vertical-png", format: "png", width: 1080, height: 1920, watermark: false },
            { id: "square-jpg-stamped", format: "jpg", width: 1080, height: 1080, watermark: true },
          ],
        }),
      });
      if (!res?.ok) throw new Error("Server export failed.");
      const data = (await res.json()) as { outputs: ExportOutput[] };
      setExportOutputs(data.outputs);
    } catch (e) {
      toast({ title: "Server export failed", description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  }

  /* ── batch look-sync ── */
  async function runBatch() {
    const urls = batchInput.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return;
    setBusy("batch"); setBatchRows(null);
    try {
      const res = await confirmedFetch("/api/photo-editor/batch-look-sync", {
        method: "POST", headers: { "Content-Type": "application/json" }, skipConfirm: true,
        body: JSON.stringify({ imageUrls: urls, recipe, format: "jpg" }),
      });
      if (!res?.ok) throw new Error("Batch failed.");
      const data = (await res.json()) as { results: BatchRow[] };
      setBatchRows(data.results);
    } catch (e) {
      toast({ title: "Batch look-sync failed", description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  }

  /* ── presets ── */
  const loadPresets = useCallback(async () => {
    try {
      const res = await confirmedFetch("/api/photo-presets", { skipConfirm: true });
      if (res?.ok) setPresets(((await res.json()) as { presets: PresetDto[] }).presets);
    } catch { /* list stays empty — honest empty state below */ }
  }, [confirmedFetch]);
  useEffect(() => { void loadPresets(); }, [loadPresets]);

  async function savePreset() {
    if (!presetName.trim()) return;
    setBusy("preset");
    try {
      const res = await confirmedFetch("/api/photo-presets", {
        method: "POST", headers: { "Content-Type": "application/json" }, skipConfirm: true,
        body: JSON.stringify({ name: presetName.trim(), recipe, isPublic: presetPublic }),
      });
      if (!res?.ok) throw new Error("Could not save the preset.");
      setPresetName("");
      await loadPresets();
      toast({ title: "Preset saved" });
    } catch (e) {
      toast({ title: "Preset not saved", description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  }

  function applyPreset(p: PresetDto) {
    if (!activeImage) { toast({ title: "Add a photo first", description: "Presets apply to a photo layer." }); return; }
    patch(activeImage, { develop: clampDevelop(p.recipe.develop) } as Partial<PhotoLayer>);
  }

  /* ── server draft (house /api/drafts slot) ── */
  async function saveDraft() {
    setBusy("draft");
    try {
      const res = await confirmedFetch("/api/drafts", {
        method: "POST", headers: { "Content-Type": "application/json" }, skipConfirm: true,
        body: JSON.stringify({ workflowType: "photo-canvas", title: "Photo canvas", draftData: { doc } }),
      });
      if (!res?.ok) throw new Error("Draft save failed.");
      toast({ title: "Draft saved" });
    } catch (e) {
      toast({ title: "Draft not saved", description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  }
  async function loadDraft() {
    setBusy("draft");
    try {
      const res = await confirmedFetch("/api/drafts?workflow=photo-canvas", { skipConfirm: true });
      if (!res?.ok) throw new Error("No draft found.");
      const data = (await res.json()) as { drafts: { draft_data: { doc?: unknown } }[] };
      const loaded = data.drafts[0]?.draft_data?.doc ? parseDoc(data.drafts[0].draft_data.doc) : null;
      if (!loaded) throw new Error("No photo canvas draft saved yet.");
      setDoc(loaded);
    } catch (e) {
      toast({ title: "Could not load draft", description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><ImageIcon className="mr-1.5 h-4 w-4" />Add photo</Button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { addPhotoFromFile(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="flex gap-1">
          <Input value={imageUrlInput} onChange={(e) => setImageUrlInput(e.target.value)} placeholder="…or paste a hosted image URL" className="h-9 w-56" />
          <Button size="sm" variant="outline" onClick={addPhotoFromUrl}><Plus className="h-4 w-4" /></Button>
        </div>
        <Button size="sm" variant="outline" onClick={() => setDoc((d) => addLayer(d, makeTextLayer("YOUR HEADLINE", d)))}><Type className="mr-1.5 h-4 w-4" />Add text</Button>
        <Button size="sm" variant="outline" onClick={() => setDoc((d) => addLayer(d, makeShapeLayer(d)))}><Square className="mr-1.5 h-4 w-4" />Add shape</Button>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => void saveDraft()} disabled={busy === "draft"}><Save className="mr-1.5 h-4 w-4" />Save draft</Button>
        <Button size="sm" variant="outline" onClick={() => void loadDraft()} disabled={busy === "draft"}><FolderOpen className="mr-1.5 h-4 w-4" />Load draft</Button>
        <Button size="sm" onClick={downloadPng} className="bg-gradient-to-r from-[#fbbf24] to-[#d4a017] text-black font-bold"><Download className="mr-1.5 h-4 w-4" />Download PNG</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
          <canvas ref={canvasRef} width={doc.width} height={doc.height} className="h-auto w-full" onContextMenu={onCanvasContextMenu} />
          <p className="px-4 py-2 text-[11px] text-white/35">
            Preview and PNG download flatten this exact layer stack. Color develop (sliders) is applied server-side in the multi-format export below — geometry, order and text are identical in both.
          </p>
        </div>

        {/* layer stack */}
        <div className="space-y-4">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="mb-3 text-sm font-bold text-white">Layers (top first)</h3>
            {doc.layers.length === 0 && <p className="text-sm text-white/40">No layers yet — add a photo to start.</p>}
            <ul className="space-y-1.5">
              {[...doc.layers].reverse().map((layer) => (
                <li key={layer.id} onContextMenu={(e) => openLayerMenu(e, layer)} className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${selectedId === layer.id ? "bg-amber-400/15 text-white" : "text-white/60"}`}>
                  <button type="button" className="flex-1 text-left" onClick={() => setSelectedId(layer.id)}>
                    {layer.kind === "text" ? "T" : layer.kind === "shape" ? "▬" : "▣"} {layer.name}
                  </button>
                  <button type="button" aria-label="Move up" onClick={() => setDoc((d) => reorderLayer(d, layer.id, 1))}><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Move down" onClick={() => setDoc((d) => reorderLayer(d, layer.id, -1))}><ArrowDown className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Duplicate" onClick={() => setDoc((d) => duplicateLayer(d, layer.id))}><Copy className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Toggle visible" onClick={() => patch(layer, { visible: !layer.visible })}>{layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
                  <button type="button" aria-label="Delete" onClick={() => setDoc((d) => removeLayer(d, layer.id))}><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          </section>

          {selected && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <h3 className="text-sm font-bold text-white">{selected.name} — placement</h3>
              {(["x", "y", "width", "height"] as const).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <Label className="w-14 text-xs capitalize text-white/50">{k}</Label>
                  <Input type="number" value={Math.round(selected.transform[k])} onChange={(e) => patchTransform(selected, { [k]: Number(e.target.value) })} className="h-8" />
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Label className="w-14 text-xs text-white/50">Rotation</Label>
                <Input type="range" min={-180} max={180} step={1} value={selected.transform.rotationDeg} onChange={(e) => patchTransform(selected, { rotationDeg: Number(e.target.value) })} className="accent-amber-400" />
                <span className="text-xs text-white/50">{selected.transform.rotationDeg}°</span>
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-14 text-xs text-white/50">Opacity</Label>
                <Input type="range" min={0} max={1} step={0.05} value={selected.transform.opacity} onChange={(e) => patchTransform(selected, { opacity: Number(e.target.value) })} className="accent-amber-400" />
              </div>

              {selected.kind === "text" && (
                <TextControls layer={selected} onPatch={(p) => patch(selected, p as Partial<PhotoLayer>)} />
              )}
              {selected.kind === "shape" && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-white/50">Fill</Label>
                  <Input type="color" value={selected.fill} onChange={(e) => patch(selected, { fill: e.target.value } as Partial<PhotoLayer>)} className="h-8 w-16 p-0" />
                  <Button size="sm" variant="outline" onClick={() => patch(selected, { shape: selected.shape === "rect" ? "ellipse" : "rect" } as Partial<PhotoLayer>)}>{selected.shape === "rect" ? "Rectangle" : "Ellipse"}</Button>
                </div>
              )}
            </section>
          )}

          {activeImage && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">Develop — {activeImage.name}</h3>
                <Button size="sm" variant="ghost" onClick={() => patch(activeImage, { develop: { ...DEFAULT_DEVELOP } } as Partial<PhotoLayer>)}>Reset</Button>
              </div>
              <p className="text-[11px] text-white/35">Raster photos only. Non-destructive — the original photo is never overwritten.</p>
              {DEVELOP_SLIDERS.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <Label className="w-32 text-xs text-white/50">{s.label}</Label>
                  <Input type="range" min={s.min} max={s.max} step={s.step}
                    value={activeImage.develop[s.key]}
                    onChange={(e) => patch(activeImage, { develop: clampDevelop({ ...activeImage.develop, [s.key]: Number(e.target.value) }) } as Partial<PhotoLayer>)}
                    className="accent-amber-400" />
                  <span className="w-10 text-right text-xs text-white/50">{activeImage.develop[s.key]}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>

      {/* export + batch + presets */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <h3 className="text-sm font-bold text-white">Multi-format export (server)</h3>
          <p className="text-xs text-white/40">One pass: PNG 16:9 + PNG 9:16 + JPG square with the branding stamp visibly applied. Develop is rendered in.</p>
          <Button size="sm" onClick={() => void serverMultiExport()} disabled={busy === "export"} className="bg-gradient-to-r from-[#fbbf24] to-[#d4a017] text-black font-bold">
            {busy === "export" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Export all formats
          </Button>
          {exportOutputs && (
            <ul className="space-y-1 text-sm">
              {exportOutputs.map((o) => (
                <li key={o.specId} className={o.ok ? "text-emerald-300" : "text-red-300"}>
                  {o.ok ? <a className="underline" href={o.url!} target="_blank" rel="noreferrer">{o.specId}{o.watermark ? " (stamped)" : ""} — download</a> : `${o.specId} — failed: ${o.error}`}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <h3 className="text-sm font-bold text-white">Batch look-sync</h3>
          <p className="text-xs text-white/40">Apply the current photo's develop recipe to many photos at once — one hosted image URL per line. Every photo gets its own result below.</p>
          <textarea value={batchInput} onChange={(e) => setBatchInput(e.target.value)} rows={4} className="w-full rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-white" placeholder={"https://…/photo1.jpg\nhttps://…/photo2.jpg"} />
          <Button size="sm" variant="outline" onClick={() => void runBatch()} disabled={busy === "batch"}>
            {busy === "batch" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Sync look to all
          </Button>
          {batchRows && (
            <ul className="space-y-1 text-xs">
              {batchRows.map((r, i) => (
                <li key={i} className={r.ok ? "text-emerald-300" : "text-red-300"}>
                  {r.ok ? <a className="underline" href={r.url!} target="_blank" rel="noreferrer">{r.imageUrl} — done</a> : `${r.imageUrl} — failed: ${r.error}`}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <h3 className="text-sm font-bold text-white">Preset packs</h3>
          <p className="text-xs text-white/40">Save the current look as a named preset. Public presets get a share link anyone can open.</p>
          <div className="flex gap-1">
            <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name" className="h-9" />
            <Button size="sm" onClick={() => void savePreset()} disabled={busy === "preset"}>Save</Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-white/50">
            <input type="checkbox" checked={presetPublic} onChange={(e) => setPresetPublic(e.target.checked)} className="accent-amber-400" />
            Public — shareable link
          </label>
          {presets.length === 0 && <p className="text-xs text-white/35">No presets saved yet.</p>}
          <ul className="space-y-1.5">
            {presets.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm text-white/70">
                <button type="button" className="flex-1 text-left underline-offset-2 hover:underline" onClick={() => applyPreset(p)}>{p.name}</button>
                {p.shareSlug && (
                  <button type="button" aria-label="Copy share link" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/photo-preset/${p.shareSlug}`); toast({ title: "Share link copied" }); }}>
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
      {renderLayerMenu()}
    </div>
  );
}

function TextControls({ layer, onPatch }: { layer: TextLayer; onPatch: (p: Partial<TextLayer>) => void }) {
  return (
    <div className="space-y-2 border-t border-white/10 pt-3">
      <Label className="text-xs text-white/50">Headline text (a real layer — edit it any time)</Label>
      <Input value={layer.text} onChange={(e) => onPatch({ text: e.target.value })} />
      <div className="flex items-center gap-2">
        <Label className="w-14 text-xs text-white/50">Font</Label>
        <select value={layer.fontId} onChange={(e) => onPatch({ fontId: e.target.value as TextLayer["fontId"] })} className="h-9 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 text-sm text-white">
          {SAFE_FONTS.map((f) => <option key={f.id} value={f.id}>{f.id}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Label className="w-14 text-xs text-white/50">Size</Label>
        <Input type="number" value={layer.fontSize} onChange={(e) => onPatch({ fontSize: Number(e.target.value) })} className="h-8" />
        <Label className="text-xs text-white/50">Color</Label>
        <Input type="color" value={layer.color} onChange={(e) => onPatch({ color: e.target.value })} className="h-8 w-14 p-0" />
      </div>
      <div className="flex items-center gap-2">
        <Label className="w-14 text-xs text-white/50">Stroke</Label>
        <Input type="color" value={layer.strokeColor ?? "#000000"} onChange={(e) => onPatch({ strokeColor: e.target.value })} className="h-8 w-14 p-0" />
        <Input type="number" value={layer.strokeWidth} onChange={(e) => onPatch({ strokeWidth: Number(e.target.value) })} className="h-8" />
        <Button size="sm" variant="ghost" onClick={() => onPatch({ strokeColor: layer.strokeColor ? null : "#000000" })}>{layer.strokeColor ? "Off" : "On"}</Button>
      </div>
      <div className="flex items-center gap-2">
        <Label className="w-14 text-xs text-white/50">Shadow</Label>
        <Input type="number" value={layer.shadowBlur} onChange={(e) => onPatch({ shadowBlur: Number(e.target.value) })} className="h-8" />
        <Button size="sm" variant="ghost" onClick={() => onPatch({ shadowColor: layer.shadowColor ? null : "rgba(0,0,0,0.55)" })}>{layer.shadowColor ? "Off" : "On"}</Button>
        <Button size="sm" variant="ghost" onClick={() => onPatch({ bold: !layer.bold })}>{layer.bold ? "Bold" : "Regular"}</Button>
      </div>
    </div>
  );
}
