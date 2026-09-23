import { useState } from "react";
import {
  EditorSettings, PreProductionState, ProductionBible, StoryboardShot, ProductionAsset,
  defaultProductionBible,
} from "@/lib/editor-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { vaultToPayload } from "@/lib/prompt-improve";
import { Button } from "@/components/ui/button";
import { BookOpen, Film, Package, Lock, Unlock, Sparkles, Loader2, Download, Trash2, Plus } from "lucide-react";

interface PreProductionSectionProps {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  songTitle?: string;
  genre?: string;
  mood?: string;
}

type SubTab = "bible" | "storyboard" | "assets";

const BIBLE_FIELDS: { key: keyof Omit<ProductionBible, "locked">; label: string; hint: string; rows: number }[] = [
  { key: "concept", label: "Concept / Logline", hint: "The story of the video in 2-3 sentences", rows: 2 },
  { key: "visualStyle", label: "Visual Style", hint: "e.g. gritty 35mm film, neon-noir, documentary realism", rows: 2 },
  { key: "colorPalette", label: "Color Palette", hint: "Exact colors — primary, secondary, accent, shadows", rows: 2 },
  { key: "locations", label: "Locations", hint: "Every location, with a visual description", rows: 2 },
  { key: "wardrobe", label: "Wardrobe", hint: "Hero outfit + alternates, fabrics, colors", rows: 2 },
  { key: "propsNeeded", label: "Props Needed", hint: "Every hero prop this video needs", rows: 2 },
  { key: "cast", label: "Cast", hint: "Who appears — artist, extras, roles", rows: 1 },
  { key: "mood", label: "Mood", hint: "Emotional tone", rows: 1 },
  { key: "doNotChange", label: "Do Not Change (continuity lock)", hint: "Rules that must never break — tattoos, jewelry, hair", rows: 2 },
];

const ASSET_CATEGORIES = ["Prop", "Wardrobe", "Location", "Vehicle", "Set Piece", "Other"] as const;

const fieldClass =
  "w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm px-3 py-2 focus:outline-none focus:border-[#C9A84C]/50 placeholder:text-white/25";

export function PreProductionSection({ settings, setSettings, songTitle, genre, mood }: PreProductionSectionProps) {
  const { getAccessToken } = useAuth();
  const { activeArtist } = useActiveArtist();
  const [subTab, setSubTab] = useState<SubTab>("bible");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pp: PreProductionState = settings.preProduction;

  const updatePP = (patch: Partial<PreProductionState>) =>
    setSettings({ ...settings, preProduction: { ...pp, ...patch } });

  const updateBible = (patch: Partial<ProductionBible>) =>
    updatePP({ bible: { ...pp.bible, ...patch } });

  const vaultPayload = activeArtist ? vaultToPayload(activeArtist) : null;

  async function api(path: string, body: Record<string, unknown>) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || "Request failed");
    return data;
  }

  /* ── Bible ── */
  async function generateBible() {
    setGenerating(true); setError(null);
    try {
      const data = await api("/api/pre-production/bible", {
        songTitle, genre, mood,
        artistName: activeArtist?.artist_name,
        artistVault: vaultPayload,
      });
      updateBible({ ...defaultProductionBible(), ...data.bible, locked: pp.bible.locked });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bible generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  /* ── Storyboard ── */
  async function generateStoryboard() {
    setGenerating(true); setError(null);
    try {
      const data = await api("/api/pre-production/storyboard", {
        songTitle,
        bible: pp.bible,
        shotCount: 10,
        artistVault: vaultPayload,
      });
      const shots: StoryboardShot[] = (data.shots || []).map((s: any, i: number) => ({
        id: `shot-${Date.now()}-${i}`,
        shotNumber: s.shotNumber ?? i + 1,
        description: s.description ?? "",
        cameraAngle: s.cameraAngle ?? "",
        durationSec: s.durationSec ?? 4,
        startFrameUrl: null, startFrameStatus: "idle",
        endFrameUrl: null, endFrameStatus: "idle",
      }));
      updatePP({ storyboard: shots });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Storyboard generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function generateFrame(shotId: string, which: "start" | "end") {
    const shot = pp.storyboard.find((s) => s.id === shotId);
    if (!shot) return;
    const statusKey = which === "start" ? "startFrameStatus" : "endFrameStatus";
    const urlKey = which === "start" ? "startFrameUrl" : "endFrameUrl";
    const errKey = which === "start" ? "startFrameError" : "endFrameError";
    updatePP({
      storyboard: pp.storyboard.map((s) =>
        s.id === shotId ? { ...s, [statusKey]: "generating", [errKey]: undefined } : s,
      ),
    });
    try {
      const data = await api("/api/pre-production/image", {
        kind: which === "start" ? "startframe" : "endframe",
        shotDescription: shot.description,
        cameraAngle: shot.cameraAngle,
        bible: pp.bible.locked ? pp.bible : null,
        artistVault: vaultPayload,
      });
      updatePP({
        storyboard: pp.storyboard.map((s) =>
          s.id === shotId ? { ...s, [statusKey]: "done", [urlKey]: data.imageUrl } : s,
        ),
      });
    } catch (e) {
      updatePP({
        storyboard: pp.storyboard.map((s) =>
          s.id === shotId
            ? { ...s, [statusKey]: "error", [errKey]: e instanceof Error ? e.message : "Failed" }
            : s,
        ),
      });
    }
  }

  function removeShot(shotId: string) {
    updatePP({
      storyboard: pp.storyboard
        .filter((s) => s.id !== shotId)
        .map((s, i) => ({ ...s, shotNumber: i + 1 })),
    });
  }

  /* ── Assets ── */
  const [assetCategory, setAssetCategory] = useState<(typeof ASSET_CATEGORIES)[number]>("Prop");
  const [assetPrompt, setAssetPrompt] = useState("");
  const [assetGenerating, setAssetGenerating] = useState(false);

  async function generateAsset() {
    if (!assetPrompt.trim() || assetGenerating) return;
    setAssetGenerating(true); setError(null);
    const id = `asset-${Date.now()}`;
    const asset: ProductionAsset = {
      id, category: assetCategory, prompt: assetPrompt.trim(),
      imageUrl: null, status: "generating", createdAt: new Date().toISOString(),
    };
    updatePP({ assets: [asset, ...pp.assets] });
    try {
      const data = await api("/api/pre-production/image", {
        kind: "asset",
        category: assetCategory,
        prompt: assetPrompt.trim(),
        bible: pp.bible.locked ? pp.bible : null,
        artistVault: vaultPayload,
      });
      updatePP({
        assets: pp.assets.map((a) =>
          a.id === id ? { ...a, status: "done", imageUrl: data.imageUrl } : a,
        ),
      });
      setAssetPrompt("");
    } catch (e) {
      updatePP({
        assets: pp.assets.map((a) =>
          a.id === id ? { ...a, status: "error", error: e instanceof Error ? e.message : "Failed" } : a,
        ),
      });
    } finally {
      setAssetGenerating(false);
    }
  }

  function removeAsset(id: string) {
    updatePP({ assets: pp.assets.filter((a) => a.id !== id) });
  }

  const tabs: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: "bible", label: "Bible", icon: <BookOpen className="w-4 h-4" /> },
    { id: "storyboard", label: "Storyboard", icon: <Film className="w-4 h-4" /> },
    { id: "assets", label: `Assets (${pp.assets.length})`, icon: <Package className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-white font-bold text-base">Pre-Production</h3>
        <p className="text-white/45 text-xs mt-0.5">
          Bible, storyboard &amp; assets — everything locked to {activeArtist ? `${activeArtist.artist_name}'s look` : "your artist"}.
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              subTab === t.id
                ? "bg-[#C9A84C]/20 text-[#C9A84C] border border-[#C9A84C]/40"
                : "bg-white/[0.04] text-white/50 border border-white/[0.08] hover:text-white/80"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* ── BIBLE ── */}
      {subTab === "bible" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={generateBible}
              disabled={generating}
              className="bg-[#C9A84C] hover:bg-[#b8963f] text-black font-bold text-xs"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {generating ? "Writing Bible…" : "Generate Bible (1 credit)"}
            </Button>
            <button
              onClick={() => updateBible({ locked: !pp.bible.locked })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                pp.bible.locked
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  : "bg-white/[0.04] text-white/50 border-white/[0.08] hover:text-white/80"
              }`}
            >
              {pp.bible.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              {pp.bible.locked ? "Locked In" : "Lock Bible"}
            </button>
            {pp.bible.locked && (
              <span className="text-[11px] text-emerald-300/70">All generation follows this bible.</span>
            )}
          </div>

          <div className="space-y-3">
            {BIBLE_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-[11px] font-bold text-white/60 uppercase tracking-wide">{f.label}</label>
                <textarea
                  value={pp.bible[f.key]}
                  onChange={(e) => updateBible({ [f.key]: e.target.value } as Partial<ProductionBible>)}
                  placeholder={f.hint}
                  rows={f.rows}
                  className={`${fieldClass} mt-1 resize-y`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── STORYBOARD ── */}
      {subTab === "storyboard" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={generateStoryboard}
              disabled={generating}
              className="bg-[#C9A84C] hover:bg-[#b8963f] text-black font-bold text-xs"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {generating ? "Boarding…" : "Generate Storyboard (1 credit)"}
            </Button>
            {!pp.bible.locked && pp.storyboard.length > 0 && (
              <span className="text-[11px] text-amber-300/70">Tip: lock your bible first so frames stay on-vision.</span>
            )}
          </div>

          {pp.storyboard.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center">
              <Film className="w-8 h-8 text-white/20 mx-auto mb-2" />
              <p className="text-white/40 text-sm">No shots yet. Generate a storyboard to get start + end frames for every shot.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pp.storyboard.map((shot) => (
                <div key={shot.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black text-[#C9A84C] bg-[#C9A84C]/15 rounded px-1.5 py-0.5">
                          SHOT {shot.shotNumber}
                        </span>
                        <span className="text-[11px] text-white/40">{shot.durationSec}s · {shot.cameraAngle}</span>
                      </div>
                      <p className="text-white/75 text-sm mt-1.5">{shot.description}</p>
                    </div>
                    <button
                      onClick={() => removeShot(shot.id)}
                      className="text-white/30 hover:text-red-300 p-1"
                      title="Remove shot"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Start / End frames */}
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { which: "start" as const, label: "START FRAME", url: shot.startFrameUrl, status: shot.startFrameStatus, err: shot.startFrameError },
                        { which: "end" as const, label: "END FRAME", url: shot.endFrameUrl, status: shot.endFrameStatus, err: shot.endFrameError },
                      ]
                    ).map((f) => (
                      <div key={f.which} className="rounded-lg overflow-hidden border border-white/[0.08] bg-black/40">
                        <div className="text-[9px] font-black tracking-widest text-white/40 px-2 py-1 bg-white/[0.03]">
                          {f.label}
                        </div>
                        {f.url ? (
                          <div className="relative group">
                            <img src={f.url} alt={`${f.label} shot ${shot.shotNumber}`} className="w-full aspect-video object-cover" />
                            <a
                              href={f.url}
                              download={`shot-${shot.shotNumber}-${f.which}-frame.png`}
                              className="absolute bottom-1.5 right-1.5 p-1.5 rounded-lg bg-black/60 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Download frame"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        ) : (
                          <button
                            onClick={() => generateFrame(shot.id, f.which)}
                            disabled={f.status === "generating"}
                            className="w-full aspect-video flex flex-col items-center justify-center gap-1.5 text-white/35 hover:text-[#C9A84C] hover:bg-[#C9A84C]/5 transition-colors"
                          >
                            {f.status === "generating" ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                              <Plus className="w-5 h-5" />
                            )}
                            <span className="text-[10px] font-bold">
                              {f.status === "generating" ? "Generating…" : f.status === "error" ? "Retry (2 credits)" : "Generate (2 credits)"}
                            </span>
                            {f.status === "error" && f.err && (
                              <span className="text-[9px] text-red-300/70 px-2 text-center">{f.err}</span>
                            )}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ASSETS ── */}
      {subTab === "assets" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {ASSET_CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setAssetCategory(c)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                    assetCategory === c
                      ? "bg-[#C9A84C]/20 text-[#C9A84C] border-[#C9A84C]/40"
                      : "bg-white/[0.04] text-white/50 border-white/[0.08] hover:text-white/80"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={assetPrompt}
                onChange={(e) => setAssetPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && generateAsset()}
                placeholder={`Describe the ${assetCategory.toLowerCase()}… e.g. "gold-plated vintage microphone"`}
                className={fieldClass}
              />
              <Button
                onClick={generateAsset}
                disabled={!assetPrompt.trim() || assetGenerating}
                className="bg-[#C9A84C] hover:bg-[#b8963f] text-black font-bold text-xs shrink-0"
              >
                {assetGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Generate (2)"}
              </Button>
            </div>
            {!pp.bible.locked && (
              <p className="text-[11px] text-amber-300/70">Tip: lock your bible so assets match the video's world.</p>
            )}
          </div>

          {pp.assets.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6 text-center">
              <Package className="w-8 h-8 text-white/20 mx-auto mb-2" />
              <p className="text-white/40 text-sm">No assets yet. Generate props, wardrobe, locations — everything the shoot needs.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {pp.assets.map((a) => (
                <div key={a.id} className="rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.02]">
                  {a.imageUrl ? (
                    <div className="relative group">
                      <img src={a.imageUrl} alt={a.prompt} className="w-full aspect-square object-cover" />
                      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between">
                        <span className="text-[10px] text-white/80 line-clamp-2 flex-1">{a.prompt}</span>
                        <div className="flex gap-1 shrink-0 ml-1">
                          <a href={a.imageUrl} download={`asset-${a.id}.png`} className="p-1.5 rounded-lg bg-black/60 text-white/70 hover:text-white" title="Download">
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          <button onClick={() => removeAsset(a.id)} className="p-1.5 rounded-lg bg-black/60 text-white/70 hover:text-red-300" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-square flex flex-col items-center justify-center gap-2 p-3 text-center">
                      {a.status === "generating" ? (
                        <Loader2 className="w-6 h-6 animate-spin text-[#C9A84C]" />
                      ) : (
                        <span className="text-xs text-red-300/80">{a.error || "Failed"}</span>
                      )}
                      <span className="text-[10px] text-white/40 line-clamp-2">{a.prompt}</span>
                      {a.status === "error" && (
                        <button onClick={() => removeAsset(a.id)} className="text-[10px] text-white/40 hover:text-white/70 underline">
                          Dismiss
                        </button>
                      )}
                    </div>
                  )}
                  <div className="px-2 py-1.5 flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#C9A84C]/80">{a.category}</span>
                    {a.imageUrl && (
                      <button onClick={() => removeAsset(a.id)} className="text-white/25 hover:text-red-300">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
