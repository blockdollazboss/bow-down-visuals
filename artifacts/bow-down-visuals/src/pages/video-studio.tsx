import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  ArrowLeft, Sparkles, Image as ImageIcon, Type, Upload,
  Video, Loader2, Download, RefreshCw, X, Check,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { callGenerateApi } from "@/lib/generate-api";
import { usePageTitle } from "@/hooks/use-page-title";
import { MarketingBadge } from "@/components/MarketingBadge";
import { ProjectFlowBar } from "@/components/hub/ProjectFlowBar";
import { AssetHandoffs } from "@/components/hub/AssetHandoffs";
import { useHubProject, type HubAsset } from "@/lib/hub-project";

/* ─── Higgsfield-style camera movements ─── */

const CAMERA_MOVEMENTS = [
  { id: "static", label: "Static", icon: "🎯", prompt: "static camera, no movement" },
  { id: "push-in", label: "Push In", icon: "🔍", prompt: "slow push in, dolly forward" },
  { id: "pull-out", label: "Pull Out", icon: "🔭", prompt: "slow pull out, reveal wider scene" },
  { id: "pan-left", label: "Pan Left", icon: "⬅️", prompt: "smooth pan left" },
  { id: "pan-right", label: "Pan Right", icon: "➡️", prompt: "smooth pan right" },
  { id: "tilt-up", label: "Tilt Up", icon: "⬆️", prompt: "tilt up, reveal sky" },
  { id: "tilt-down", label: "Tilt Down", icon: "⬇️", prompt: "tilt down, reveal ground" },
  { id: "orbit-left", label: "Orbit Left", icon: "🔄", prompt: "orbit around subject to the left" },
  { id: "orbit-right", label: "Orbit Right", icon: "🔃", prompt: "orbit around subject to the right" },
  { id: "zoom-in", label: "Zoom In", icon: "➕", prompt: "slow zoom in on subject" },
  { id: "zoom-out", label: "Zoom Out", icon: "➖", prompt: "slow zoom out" },
  { id: "tracking", label: "Tracking", icon: "🎥", prompt: "tracking shot following subject" },
] as const;

const DURATIONS = [5, 10, 15, 30];
const ASPECTS = [
  { id: "16:9", label: "16:9", icon: "🖥️" },
  { id: "9:16", label: "9:16", icon: "📱" },
  { id: "1:1", label: "1:1", icon: "⬛" },
] as const;

/* ─── One-click presets — full workflow in one tap ─── */

const ONE_CLICK_PRESETS = [
  {
    id: "cinematic-intro",
    label: "Cinematic Intro",
    icon: "🎬",
    blurb: "5s dramatic opener",
    prompt: "cinematic opening shot, dramatic lighting, epic scale",
    camera: "push-in",
    duration: 5,
    aspect: "16:9",
  },
  {
    id: "product-showcase",
    label: "Product Showcase",
    icon: "📦",
    blurb: "10s rotating product",
    prompt: "luxury product on pedestal, studio lighting, rotating showcase",
    camera: "orbit-right",
    duration: 10,
    aspect: "1:1",
  },
  {
    id: "social-teaser",
    label: "Social Teaser",
    icon: "📱",
    blurb: "15s vertical hook",
    prompt: "eye-catching vertical video, bold visuals, high energy",
    camera: "zoom-in",
    duration: 15,
    aspect: "9:16",
  },
  {
    id: "music-clip",
    label: "Music Video Clip",
    icon: "🎵",
    blurb: "10s performance shot",
    prompt: "artist performing on stage, concert lighting, crowd energy",
    camera: "tracking",
    duration: 10,
    aspect: "16:9",
  },
] as const;

interface GeneratedVideo {
  url: string;
  prompt: string;
  camera: string;
  createdAt: string;
}

export default function VideoStudio() {
  const { t } = useTranslation();
  const { getAccessToken, refreshProfile } = useAuth();
  usePageTitle("AI Video Studio", "Generate cinematic videos with camera controls");

  const [mode, setMode] = useState<"text" | "image">("text");
  const [prompt, setPrompt] = useState("");
  const [camera, setCamera] = useState<string>("push-in");
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState<string>("16:9");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { addAsset } = useHubProject();

  /* Spine: pick up the project's song — its music-video idea becomes the
     prompt, and a project thumbnail can anchor image-to-video. */
  function handleProjectPick(asset: HubAsset) {
    if (asset.kind === "song") {
      const idea = asset.meta?.["musicVideoIdea"];
      if (idea && !prompt.trim()) setPrompt(idea);
      else if (!prompt.trim()) setPrompt(`${asset.label} — cinematic music video shot`);
      setAspect("16:9");
    } else if (asset.kind === "script") {
      const hook = asset.meta?.["hook"];
      if (hook && !prompt.trim()) setPrompt(`Cinematic visual for: ${hook}`);
    } else if (asset.kind === "thumbnail" || asset.kind === "image") {
      setMode("image");
      setReferenceImage(asset.url);
    }
  }

  function applyPreset(preset: typeof ONE_CLICK_PRESETS[number]) {
    setPrompt(preset.prompt);
    setCamera(preset.camera);
    setDuration(preset.duration);
    setAspect(preset.aspect);
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setReferenceImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const cameraPrompt = CAMERA_MOVEMENTS.find((c) => c.id === camera)?.prompt || "";
      const fullPrompt = `${prompt.trim()}, ${cameraPrompt}`;

      // Use existing video generation API
      const result = await callGenerateApi("/api/generate-video", {
        prompt: fullPrompt,
        duration,
        aspectRatio: aspect,
        referenceImage: mode === "image" ? referenceImage : undefined,
      }, token);

      const videoUrl = (result as unknown as { url?: string })?.url || result?.thumbnailImageUrl;
      if (videoUrl) {
        setVideos((prev) => [{
          url: videoUrl,
          prompt: prompt.trim(),
          camera,
          createdAt: new Date().toISOString(),
        }, ...prev]);
        /* Spine: every finished clip lands in the hub project — the editor,
           promo clips and scheduler pick it up with one tap. */
        addAsset({
          kind: "video",
          url: videoUrl,
          label: prompt.trim().slice(0, 80) || "AI video",
          detail: `${duration}s · ${aspect} · ${camera}`,
          meta: { prompt: prompt.trim().slice(0, 300), camera, duration: String(duration), aspect },
        });
        refreshProfile();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-10">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white mb-8">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-11 w-11 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center">
              <Video className="h-5 w-5 text-primary" />
            </div>
            <MarketingBadge variant="muted">AI Video Studio</MarketingBadge>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            Create Cinematic Videos
          </h1>
          <p className="text-white/50 text-lg">
            Describe your scene, pick a camera move, generate.
          </p>
        </div>

        {/* One-click presets */}
        <div className="mb-8">
          <ProjectFlowBar
            kinds={["song", "script", "thumbnail", "image"]}
            actionLabel={t("hubSpine.flowBar.useSongInVideo")}
            onPick={handleProjectPick}
          />
          <label className="block text-sm font-medium text-white/70 mb-3">
            One-click workflows
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ONE_CLICK_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                className="flex flex-col items-center gap-1 p-4 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all text-center"
              >
                <span className="text-3xl">{preset.icon}</span>
                <span className="text-sm font-semibold text-white">{preset.label}</span>
                <span className="text-xs text-white/50">{preset.blurb}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-white/40 mt-2">
            Tap a preset to auto-fill everything, then hit Generate.
          </p>
        </div>

        {/* Mode tabs - Higgsfield style */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMode("text")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all ${
              mode === "text"
                ? "bg-primary text-black"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            <Type className="h-4 w-4" /> Text to Video
          </button>
          <button
            onClick={() => setMode("image")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all ${
              mode === "image"
                ? "bg-primary text-black"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            <ImageIcon className="h-4 w-4" /> Image to Video
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Left: Controls */}
          <div className="md:col-span-2 space-y-6">
            {/* Prompt box - large and prominent */}
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Describe your video
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A shark king on a golden throne, dramatic lighting, cinematic..."
                rows={4}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none"
              />
            </div>

            {/* Reference image (for image mode) */}
            {mode === "image" && (
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Reference image
                </label>
                {referenceImage ? (
                  <div className="relative inline-block">
                    <img src={referenceImage} alt="Reference" className="h-32 rounded-xl border border-white/10" />
                    <button
                      onClick={() => setReferenceImage(null)}
                      className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 flex items-center justify-center"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-3 bg-white/5 border border-dashed border-white/20 rounded-xl hover:border-primary/50 transition-colors"
                  >
                    <Upload className="h-4 w-4" /> Upload image
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
            )}

            {/* Camera movements - Higgsfield style chips */}
            <div>
              <label className="block text-sm font-medium text-white/70 mb-3">
                Camera movement
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {CAMERA_MOVEMENTS.map((cm) => (
                  <button
                    key={cm.id}
                    onClick={() => setCamera(cm.id)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${
                      camera === cm.id
                        ? "border-primary bg-primary/10 text-white"
                        : "border-white/10 bg-white/5 text-white/60 hover:border-white/30"
                    }`}
                  >
                    <span className="text-2xl">{cm.icon}</span>
                    <span className="text-xs font-medium">{cm.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Duration and aspect */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Duration</label>
                <div className="flex gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDuration(d)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        duration === d
                          ? "bg-primary text-black"
                          : "bg-white/5 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Aspect</label>
                <div className="flex gap-2">
                  {ASPECTS.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAspect(a.id)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        aspect === a.id
                          ? "bg-primary text-black"
                          : "bg-white/5 text-white/60 hover:bg-white/10"
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || generating || (mode === "image" && !referenceImage)}
              className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-primary text-black font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {generating ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5" /> Generate Video
                </>
              )}
            </button>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Right: Tips */}
          <div className="space-y-4">
            <div className="p-5 bg-white/5 border border-white/10 rounded-xl">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Pro tips
              </h3>
              <ul className="space-y-2 text-sm text-white/60">
                <li>• Be specific about lighting and mood</li>
                <li>• Mention camera movement in your prompt too</li>
                <li>• Start with 5s to test, then go longer</li>
                <li>• Use reference images for consistency</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Gallery */}
        {videos.length > 0 && (
          <div className="mt-12">
            <h2 className="text-xl font-bold mb-4">Your videos</h2>
            {videos[0] && (
              <div className="mb-6">
                <AssetHandoffs
                  asset={{
                    id: `vs-${videos[0].createdAt}`,
                    kind: "video",
                    url: videos[0].url,
                    label: videos[0].prompt.slice(0, 80) || "AI video",
                    createdAt: Date.parse(videos[0].createdAt) || Date.now(),
                  }}
                  handoffs={["loop", "auto-captions"]}
                />
              </div>
            )}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {videos.map((v, i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  <video src={v.url} controls className="w-full aspect-video bg-black" />
                  <div className="p-3">
                    <p className="text-sm text-white/70 line-clamp-2">{v.prompt}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-white/40">
                        {CAMERA_MOVEMENTS.find((c) => c.id === v.camera)?.label}
                      </span>
                      <a
                        href={v.url}
                        download
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Download className="h-3 w-3" /> Download
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
