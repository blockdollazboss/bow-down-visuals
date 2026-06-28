/**
 * /studio/:projectId — Bow Down Studio Editor (Full Workspace)
 *
 * All-in-one music video workspace with 14 tabs. Each tab is a dedicated
 * panel covering a stage of music video production. Reads existing project
 * data and integrates all existing tools — nothing is removed.
 *
 * Tabs: Overview · Song & Audio · Lyrics · Artist Profile · Video Clips ·
 *        Timeline · Lip Sync · Captions · Effects · Overlays · Promo ·
 *        Thumbnail · Export · Credits
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft, Loader2, AlertTriangle,
  Play, Pause, SkipBack, Volume2, VolumeX, SkipForward,
  LayoutDashboard, Music2, FileText, User, Film, Layers,
  Mic2, AlignLeft, Zap, Layout, Clapperboard, Image as ImageIcon,
  Download, CreditCard,
  Check, RefreshCw, ExternalLink, Lock, Copy,
  AlertCircle, CheckCircle2, Clock, Sparkles, Star,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveArtist } from "@/contexts/ActiveArtistContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseScenesWithMode, extractBreakdownContent, type SceneData } from "@/lib/scene-parser";
import {
  normalizeEditorSettings, getClipEdit, defaultClipEdit,
  type EditorSettings,
} from "@/lib/editor-settings";
import { MusicStudio } from "@/components/editor/music/MusicStudio";
import { BrandingSection } from "@/components/editor/sections/BrandingSection";
import { StudioEditorSection, type LockedTimeline } from "@/components/editor/sections/StudioEditorSection";

/* ─── Tab types & config ─────────────────────────────────────────────── */

type StudioTab =
  | "overview" | "song" | "lyrics" | "artist" | "clips"
  | "timeline" | "lipsync" | "captions" | "effects" | "overlays"
  | "promo" | "thumbnail" | "export" | "credits";

const TAB_CONFIG: { id: StudioTab; label: string; icon: React.ElementType; short: string }[] = [
  { id: "overview",   label: "Overview",        icon: LayoutDashboard, short: "Overview"  },
  { id: "song",       label: "Song & Audio",     icon: Music2,          short: "Song"      },
  { id: "lyrics",     label: "Lyrics",           icon: FileText,        short: "Lyrics"    },
  { id: "artist",     label: "Artist Profile",   icon: User,            short: "Artist"    },
  { id: "clips",      label: "Video Clips",      icon: Film,            short: "Clips"     },
  { id: "timeline",   label: "Timeline",         icon: Layers,          short: "Timeline"  },
  { id: "lipsync",    label: "Lip Sync",         icon: Mic2,            short: "Lip Sync"  },
  { id: "captions",   label: "Captions",         icon: AlignLeft,       short: "Captions"  },
  { id: "effects",    label: "Effects",          icon: Zap,             short: "Effects"   },
  { id: "overlays",   label: "Overlays / Brand", icon: Layout,          short: "Overlays"  },
  { id: "promo",      label: "Promo Clips",      icon: Clapperboard,    short: "Promo"     },
  { id: "thumbnail",  label: "Thumbnail",        icon: ImageIcon,       short: "Thumbnail" },
  { id: "export",     label: "Export",           icon: Download,        short: "Export"    },
  { id: "credits",    label: "Credits",          icon: CreditCard,      short: "Credits"   },
];

/* ─── Types ─────────────────────────────────────────────────────────── */

interface LoadedProject {
  id: string;
  title: string;
  project_type: string;
  artist_name: string | null;
  song_title: string | null;
  genre: string | null;
  mood: string | null;
  credits_used: number;
  created_at: string;
  input_data: Record<string, unknown> | null;
  output_data: {
    result?: string;
    scenes?: SceneData[];
    editorSettings?: Partial<EditorSettings>;
    lockedTimeline?: LockedTimeline;
    songStructure?: unknown;
  } | null;
}

interface StudioPanelProps {
  project: LoadedProject;
  scenes: SceneData[];
  setScenes: (s: SceneData[]) => void;
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  projectId: string;
  getAccessToken: () => Promise<string | null>;
  audioUrl: string | null;
  currentTime: number;
  audioDuration: number | null;
  isPlaying: boolean;
  onSeek: (sec: number) => void;
  onTogglePlay: () => void;
  onRestart: () => void;
  onTabChange: (tab: StudioTab) => void;
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function parseDur(ts: string | null | undefined): number {
  if (!ts) return 5;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const s = +m[1]! * 60 + +m[2]!;
    const e = +m[3]! * 60 + +m[4]!;
    return e > s ? e - s : 5;
  }
  return 5;
}

/* ─── Panel: Section heading shared component ──────────────────────── */

function PanelHeading({ icon: Icon, title, subtitle, action }: {
  icon: React.ElementType; title: string; subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Icon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-black text-white uppercase tracking-wider">{title}</h2>
        </div>
        {subtitle && <p className="text-[11px] text-white/35 ml-6">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function LegacyEditorLink({ projectId, label = "Open in Legacy Editor" }: { projectId: string; label?: string }) {
  return (
    <Link href={`/video-editor?project=${projectId}`}>
      <button type="button" className="flex items-center gap-1.5 text-[10px] text-white/30 hover:text-primary/70 transition-colors">
        <ExternalLink className="h-3 w-3" /> {label}
      </button>
    </Link>
  );
}

/* ─── Panel: Overview ───────────────────────────────────────────────── */

function OverviewPanel({ project, scenes, settings, audioUrl, audioDuration, projectId, onTabChange }: StudioPanelProps) {
  const clipsWithUrl = useMemo(() => scenes.filter(s => {
    const ce = settings.clips?.[s.id];
    return (ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl) || !!s.demoClipUrl;
  }).length, [scenes, settings]);

  const lipSyncCount = useMemo(() => scenes.filter(s => {
    const ce = settings.clips?.[s.id];
    return ce?.useLipSync && ce.lipSyncStatus === "done";
  }).length, [scenes, settings]);

  const isTimelineLocked = !!project.output_data?.lockedTimeline;

  const checks: { label: string; ok: boolean; detail: string; tab: StudioTab; icon: React.ElementType }[] = [
    {
      label: "Song Audio",
      ok: !!audioUrl,
      detail: audioUrl ? (audioDuration ? `${fmt(audioDuration)} loaded` : "Loaded") : "No audio — add in Song & Audio",
      tab: "song",
      icon: Music2,
    },
    {
      label: "Video Clips",
      ok: clipsWithUrl === scenes.length && scenes.length > 0,
      detail: scenes.length === 0 ? "No scenes yet" : `${clipsWithUrl} / ${scenes.length} clips ready`,
      tab: "clips",
      icon: Film,
    },
    {
      label: "Lip Sync",
      ok: lipSyncCount > 0,
      detail: lipSyncCount > 0 ? `${lipSyncCount} clip${lipSyncCount !== 1 ? "s" : ""} lip-synced` : "Not started",
      tab: "lipsync",
      icon: Mic2,
    },
    {
      label: "Timeline",
      ok: isTimelineLocked,
      detail: isTimelineLocked ? `Locked: ${project.output_data!.lockedTimeline!.id}` : "Lock in Timeline tab",
      tab: "timeline",
      icon: Layers,
    },
    {
      label: "Export",
      ok: isTimelineLocked && !!audioUrl && clipsWithUrl > 0,
      detail: isTimelineLocked ? "Ready to export" : "Lock timeline first",
      tab: "export",
      icon: Download,
    },
    {
      label: "Credits Used",
      ok: true,
      detail: `${project.credits_used} credit${project.credits_used !== 1 ? "s" : ""} on this project`,
      tab: "credits",
      icon: CreditCard,
    },
  ];

  const readyCount = checks.filter(c => c.tab !== "credits" && c.ok).length;

  return (
    <div className="space-y-6">
      <PanelHeading icon={LayoutDashboard} title="Project Overview"
        subtitle={`${project.project_type} · Created ${new Date(project.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`} />

      {/* Status cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {checks.map(c => (
          <button key={c.label} type="button" onClick={() => onTabChange(c.tab)}
            className="rounded-xl border text-left px-3 py-3 transition-all hover:border-primary/20 hover:bg-primary/[0.03] group"
            style={{ borderColor: c.ok ? "rgba(201,168,76,0.25)" : "rgba(255,255,255,0.06)" }}>
            <div className="flex items-center gap-2 mb-1.5">
              <c.icon className={`h-3.5 w-3.5 shrink-0 ${c.ok ? "text-green-400" : "text-white/25"}`} />
              <span className={`text-[10px] font-black uppercase tracking-widest ${c.ok ? "text-white/60" : "text-white/30"}`}>
                {c.label}
              </span>
            </div>
            <p className={`text-[9px] font-mono ${c.ok ? "text-white/45" : "text-amber-400/70"}`}>{c.detail}</p>
            <p className="text-[8px] text-primary/40 mt-1 group-hover:text-primary/60 transition-colors">
              Open →
            </p>
          </button>
        ))}
      </div>

      {/* Project info */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[9px] text-white/25 uppercase tracking-widest mb-3">Project Info</p>
          {[
            ["Title", project.title || "—"],
            ["Artist", project.artist_name || "—"],
            ["Song", project.song_title || "—"],
            ["Genre", project.genre || "—"],
            ["Mood", project.mood || "—"],
            ["Type", project.project_type],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2 mb-1.5 text-[10px]">
              <span className="text-white/25 w-12 shrink-0">{k}</span>
              <span className="text-white/55 truncate">{v}</span>
            </div>
          ))}
        </div>
        <div>
          <p className="text-[9px] text-white/25 uppercase tracking-widest mb-3">Quick Actions</p>
          <div className="space-y-1.5">
            {TAB_CONFIG.filter(t => ["song","clips","timeline","export","credits"].includes(t.id)).map(t => (
              <button key={t.id} type="button" onClick={() => onTabChange(t.id)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-white/[0.05] bg-white/[0.02] hover:border-primary/20 hover:bg-primary/[0.04] transition-colors text-left">
                <t.icon className="h-3 w-3 text-white/30 shrink-0" />
                <span className="text-[10px] text-white/50">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Progress summary */}
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.01]">
        <div className="flex-1">
          <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${(readyCount / 5) * 100}%` }} />
          </div>
        </div>
        <span className="text-[9px] font-mono text-white/30 shrink-0">{readyCount}/5 stages ready</span>
      </div>

      <LegacyEditorLink projectId={projectId} label="Switch to Legacy Video Editor" />
    </div>
  );
}

/* ─── Panel: Song & Audio ───────────────────────────────────────────── */

function SongPanel({ project, settings, setSettings, projectId, getAccessToken, audioUrl, audioDuration, currentTime, isPlaying, onSeek, onTogglePlay, onRestart, onTabChange }: StudioPanelProps) {
  const artistName = project.artist_name ?? undefined;
  const songTitle = project.song_title ?? undefined;

  const transcript = (project.output_data?.result && typeof project.output_data.result === "string")
    ? project.output_data.result : null;

  function handleTranscriptReady(_text: string) {
    // transcript saved via MusicStudio internally
  }

  return (
    <div className="space-y-5">
      <PanelHeading icon={Music2} title="Song & Audio"
        subtitle="Upload song · manage stems · AI mix plan · audio analysis"
        action={<LegacyEditorLink projectId={projectId} label="Music Studio →" />} />

      {/* Song quick info */}
      {audioUrl && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/[0.03] px-3 py-2.5 flex items-center gap-3">
          <Volume2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-green-400">Song audio loaded</p>
            <p className="text-[8px] text-white/30 font-mono truncate mt-0.5">{audioUrl}</p>
          </div>
          {audioDuration && (
            <span className="text-[10px] font-mono text-white/40 shrink-0">{fmt(audioDuration)}</span>
          )}
        </div>
      )}

      {/* Transport mini bar */}
      {audioUrl && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center gap-3 mb-2">
            <button type="button" onClick={onRestart}
              className="p-1.5 rounded-lg text-white/30 hover:text-white/80 hover:bg-white/[0.05] transition-colors">
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onTogglePlay}
              className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors">
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
            </button>
            <span className="font-mono text-xs text-white/40">{fmt(currentTime)}</span>
            <div className="flex-1 h-1 bg-white/[0.08] rounded-full overflow-hidden cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                onSeek(((e.clientX - rect.left) / rect.width) * (audioDuration ?? 0));
              }}>
              <div className="h-full bg-primary/60 rounded-full transition-none"
                style={{ width: audioDuration && audioDuration > 0 ? `${(currentTime / audioDuration) * 100}%` : "0%" }} />
            </div>
            <span className="font-mono text-xs text-white/40">{audioDuration ? fmt(audioDuration) : "--:--"}</span>
          </div>
        </div>
      )}

      {!audioUrl && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3 py-3 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-bold text-amber-300">No song audio in this project</p>
            <p className="text-[9px] text-white/35 mt-1">
              Upload your song in the Legacy Editor's Music Studio tab, or create a new "Make Song + Video" project.
            </p>
            <Link href={`/video-editor?project=${projectId}`}>
              <button type="button" className="mt-2 flex items-center gap-1.5 text-[9px] text-primary/70 hover:text-primary border border-primary/20 rounded px-2 py-1">
                <ExternalLink className="h-3 w-3" /> Open Music Studio
              </button>
            </Link>
          </div>
        </div>
      )}

      {/* MusicStudio component */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
        <MusicStudio
          settings={settings}
          onChange={setSettings}
          artistName={artistName}
          songTitle={songTitle}
          audioUrl={audioUrl}
          projectId={projectId}
          getAccessToken={getAccessToken}
          onTranscriptReady={handleTranscriptReady}
          transcriptText={transcript}
          onGoToCaptions={() => onTabChange("captions")}
        />
      </div>
    </div>
  );
}

/* ─── Panel: Lyrics ─────────────────────────────────────────────────── */

function LyricsPanel({ project, projectId, getAccessToken }: StudioPanelProps) {
  const rawLyrics = useMemo(() => {
    const inp = project.input_data?.["lyrics"] ?? project.input_data?.["existingLyrics"];
    if (typeof inp === "string" && inp.length > 5) return inp;
    const res = project.output_data?.result ?? "";
    const m = res.match(/##\s*FULL LYRICS\s*\n([\s\S]+?)(?=\n##|$)/i);
    if (m) return m[1]?.trim() ?? "";
    return res;
  }, [project]);

  const [editing, setEditing] = useState(false);
  const [lyricsText, setLyricsText] = useState(rawLyrics);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const token = await getAccessToken();
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ outputData: { lyrics: lyricsText } }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(lyricsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-5">
      <PanelHeading icon={FileText} title="Lyrics"
        subtitle="View and edit your song lyrics · used for captions and section mapping"
        action={
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCopy}
              className="flex items-center gap-1.5 text-[10px] text-white/30 hover:text-white/60 border border-white/[0.08] rounded px-2 py-1">
              {copied ? <><Check className="h-2.5 w-2.5 text-green-400" /> Copied</> : <><Copy className="h-2.5 w-2.5" /> Copy</>}
            </button>
            {!editing && (
              <button type="button" onClick={() => setEditing(true)}
                className="text-[10px] text-primary/60 hover:text-primary border border-primary/20 rounded px-2 py-1">
                Edit
              </button>
            )}
          </div>
        }
      />

      {lyricsText ? (
        editing ? (
          <div className="space-y-3">
            <textarea
              value={lyricsText}
              onChange={e => setLyricsText(e.target.value)}
              rows={20}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white/70 font-mono leading-relaxed resize-y focus:outline-none focus:border-primary/30"
              placeholder="Paste or type your lyrics here…"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}
                className="gap-2 text-xs">
                {saving ? <><RefreshCw className="h-3 w-3 animate-spin" /> Saving…</> : <><Check className="h-3 w-3" /> Save Lyrics</>}
              </Button>
              {saved && <span className="text-[10px] text-green-400">✓ Saved</span>}
              <button type="button" onClick={() => { setLyricsText(rawLyrics); setEditing(false); }}
                className="text-[10px] text-white/30 hover:text-white/60 ml-auto">Cancel</button>
            </div>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-white/60 leading-relaxed bg-white/[0.02] border border-white/[0.06] rounded-xl px-4 py-4 max-h-[60vh] overflow-y-auto">
            {lyricsText}
          </pre>
        )
      ) : (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.01] px-4 py-8 text-center">
          <FileText className="h-8 w-8 text-white/15 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No lyrics saved to this project yet.</p>
          <button type="button" onClick={() => setEditing(true)}
            className="mt-3 text-[11px] text-primary/60 hover:text-primary border border-primary/20 rounded px-3 py-1.5">
            Add Lyrics
          </button>
        </div>
      )}

      <div className="text-[9px] text-white/20 font-mono">
        {lyricsText.length} characters · {lyricsText.split("\n").length} lines
      </div>
    </div>
  );
}

/* ─── Panel: Artist Profile ─────────────────────────────────────────── */

function ArtistPanel({ project, projectId }: StudioPanelProps) {
  const { activeArtist } = useActiveArtist();

  return (
    <div className="space-y-5">
      <PanelHeading icon={User} title="Artist Profile"
        subtitle="Artist identity · reference images · character consistency lock" />

      {activeArtist ? (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-4 flex items-start gap-4">
          {activeArtist.reference_image_url && (
            <img src={activeArtist.reference_image_url} alt={activeArtist.artist_name}
              className="h-16 w-16 rounded-xl object-cover border border-white/10 shrink-0" />
          )}
          <div>
            <p className="text-[9px] text-primary/50 font-bold uppercase tracking-widest mb-1">Active Artist</p>
            <p className="text-base font-black text-white">{activeArtist.artist_name}</p>
            {activeArtist.visual_style && (
              <p className="text-[10px] text-white/40 mt-1 line-clamp-2">{activeArtist.visual_style}</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {activeArtist.genre && (
                <span className="text-[9px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/40">{activeArtist.genre}</span>
              )}
              {activeArtist.reference_image_url && (
                <span className="text-[9px] text-white/30">1 ref image</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
          <AlertCircle className="h-4 w-4 text-amber-400 mb-2" />
          <p className="text-sm font-bold text-amber-300">No active artist set</p>
          <p className="text-[10px] text-white/35 mt-1">Set an active artist to use in clip generation and lip sync.</p>
        </div>
      )}

      {/* Reference image */}
      {activeArtist?.reference_image_url && (
        <div>
          <p className="text-[9px] text-white/25 uppercase tracking-widest mb-2">Reference Image</p>
          <div className="flex flex-wrap gap-2">
            <img src={activeArtist.reference_image_url} alt="Artist reference"
              className="h-24 w-24 rounded-lg object-cover border border-white/10" />
          </div>
        </div>
      )}

      {/* Project artist name */}
      {project.artist_name && (
        <div className="rounded-xl border border-white/[0.07] px-3 py-2.5">
          <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">Project Artist Name</p>
          <p className="text-sm text-white/60">{project.artist_name}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Link href="/artist-vault">
          <Button variant="outline" size="sm" className="border-white/10 text-white/60 hover:text-white gap-2 text-xs">
            <User className="h-3.5 w-3.5" /> Artist Vault
          </Button>
        </Link>
        <Link href={`/video-editor?project=${projectId}`}>
          <Button variant="outline" size="sm" className="border-white/10 text-white/60 hover:text-white gap-2 text-xs">
            <ExternalLink className="h-3.5 w-3.5" /> Edit in Legacy Editor
          </Button>
        </Link>
      </div>
    </div>
  );
}

/* ─── Panel: Video Clips ─────────────────────────────────────────────── */

function ClipsPanel({ project, scenes, settings, projectId, audioUrl, audioDuration, onTabChange }: StudioPanelProps) {
  const rawDurs = scenes.map(s => parseDur(s.timestamp));
  const allDefault = rawDurs.length > 0 && rawDurs.every(d => d === 5);
  const durs = (allDefault && audioDuration && audioDuration > 0)
    ? scenes.map(() => audioDuration / scenes.length)
    : rawDurs;

  const offsets: number[] = [];
  let acc = 0;
  for (const d of durs) { offsets.push(acc); acc += d; }

  const ready = scenes.filter((s, _i) => {
    const ce = settings.clips?.[s.id];
    return (ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl) || !!s.demoClipUrl;
  });

  const missing = scenes.filter((s, _i) => {
    const ce = settings.clips?.[s.id];
    return !((ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl) || s.demoClipUrl);
  });

  return (
    <div className="space-y-5">
      <PanelHeading icon={Film} title="Video Clips"
        subtitle="Runway-generated AI video clips per scene"
        action={<LegacyEditorLink projectId={projectId} label="Generate / Repair →" />} />

      {/* Summary bar */}
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div className="h-full bg-green-500/60 rounded-full transition-all"
            style={{ width: scenes.length > 0 ? `${(ready.length / scenes.length) * 100}%` : "0%" }} />
        </div>
        <span className={`text-[10px] font-bold shrink-0 ${ready.length === scenes.length && scenes.length > 0 ? "text-green-400" : "text-amber-400"}`}>
          {ready.length} / {scenes.length} clips ready
        </span>
      </div>

      {scenes.length === 0 ? (
        <div className="rounded-xl border border-white/[0.07] px-4 py-8 text-center">
          <Film className="h-8 w-8 text-white/15 mx-auto mb-3" />
          <p className="text-white/30 text-sm mb-3">No scenes in this project yet.</p>
          <Link href={`/video-editor?project=${projectId}`}>
            <Button size="sm" className="gap-2 text-xs">
              <ExternalLink className="h-3.5 w-3.5" /> Open Legacy Editor to Generate Clips
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {scenes.map((scene, i) => {
            const ce = settings.clips?.[scene.id];
            const useLipSync = !!(ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl);
            const clipUrl = useLipSync ? ce!.lipSyncUrl! : (scene.demoClipUrl ?? null);
            const hasUrl = !!clipUrl;
            const clipStart = offsets[i] ?? 0;
            const clipDur = durs[i] ?? 5;

            return (
              <div key={scene.id}
                className={`rounded-xl border overflow-hidden transition-all ${
                  hasUrl ? "border-green-500/20 bg-green-500/[0.03]" : "border-amber-500/25 bg-amber-500/[0.04]"
                }`}>
                {/* Clip preview or placeholder */}
                <div className="relative bg-black" style={{ aspectRatio: "9/16", maxHeight: 150 }}>
                  {clipUrl ? (
                    <video src={clipUrl} muted playsInline loop
                      className="w-full h-full object-cover"
                      onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={e => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-amber-400/40">
                      <Film className="h-5 w-5" />
                      <span className="text-[8px] font-bold">No Clip</span>
                    </div>
                  )}
                  {/* Badges */}
                  <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                    <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full ${
                      hasUrl ? "bg-green-500/80 text-black" : "bg-amber-500/80 text-black"
                    }`}>
                      {hasUrl ? "✓" : "⚠"} {i + 1}
                    </span>
                    {useLipSync && (
                      <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/80 text-white">LS</span>
                    )}
                  </div>
                </div>

                <div className="px-2 py-2 space-y-1">
                  <p className="text-[9px] font-bold text-white truncate">{scene.section || `Scene ${i + 1}`}</p>
                  <p className="text-[8px] font-mono text-white/30">{fmt(clipStart)} · {clipDur.toFixed(1)}s</p>
                  {scene.aiVideoPrompt && (
                    <p className="text-[7px] text-white/25 line-clamp-2 leading-snug">{scene.aiVideoPrompt}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {missing.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-3 py-3">
          <p className="text-[10px] font-bold text-amber-300 mb-2">
            {missing.length} clip{missing.length !== 1 ? "s" : ""} missing — open Legacy Editor to repair or regenerate
          </p>
          <div className="flex flex-wrap gap-1 mb-3">
            {missing.map((s, idx) => (
              <span key={idx} className="text-[8px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
                {s.section || `Scene ${scenes.indexOf(s) + 1}`}
              </span>
            ))}
          </div>
          <Link href={`/video-editor?project=${projectId}`}>
            <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 gap-2 text-xs">
              <ExternalLink className="h-3.5 w-3.5" /> Repair in Legacy Editor
            </Button>
          </Link>
        </div>
      )}

      {ready.length === scenes.length && scenes.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-green-500/20 bg-green-500/[0.03]">
          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
          <p className="text-[10px] text-green-400 font-bold">All {scenes.length} clips ready! Go to Timeline to lock and export.</p>
          <button type="button" onClick={() => onTabChange("timeline")}
            className="ml-auto text-[9px] text-green-400/70 hover:text-green-400 underline">
            Open Timeline →
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Panel: Timeline ───────────────────────────────────────────────── */

function TimelinePanel(props: StudioPanelProps) {
  return (
    <div className="space-y-4">
      <PanelHeading icon={Layers} title="Timeline Editor"
        subtitle="CapCut-style timeline · lock clips · trim · export blueprint"
        action={<LegacyEditorLink projectId={props.projectId} />} />
      <StudioEditorSection
        scenes={props.scenes}
        settings={props.settings}
        setSettings={props.setSettings}
        setScenes={props.setScenes}
        projectId={props.projectId}
        getAccessToken={props.getAccessToken}
        currentTime={props.currentTime}
        audioDuration={props.audioDuration}
        isPlaying={props.isPlaying}
        audioUrl={props.audioUrl}
        onSeek={props.onSeek}
        onTogglePlay={props.onTogglePlay}
        onRestart={props.onRestart}
        onGoToExport={() => props.onTabChange("export")}
        onGoToMusic={() => props.onTabChange("song")}
      />
    </div>
  );
}

/* ─── Panel: Lip Sync ────────────────────────────────────────────────── */

function LipSyncPanel({ project, scenes, settings, projectId, audioUrl }: StudioPanelProps) {
  const lipSyncScenes = scenes.filter(s => {
    const ce = settings.clips?.[s.id];
    return ce?.useLipSync;
  });
  const doneScenes = lipSyncScenes.filter(s => settings.clips?.[s.id]?.lipSyncStatus === "done");
  const pendingScenes = lipSyncScenes.filter(s => settings.clips?.[s.id]?.lipSyncStatus === "processing");

  return (
    <div className="space-y-5">
      <PanelHeading icon={Mic2} title="Lip Sync"
        subtitle="Sync.so integration · animate artist mouth to uploaded song audio"
        action={<LegacyEditorLink projectId={projectId} label="Open Lip Sync Studio →" />} />

      {!audioUrl && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <p className="text-[10px] text-amber-300">Song audio required for lip sync. Add audio in Song & Audio tab first.</p>
        </div>
      )}

      {/* Status summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: lipSyncScenes.length, color: "text-white/50" },
          { label: "Done", value: doneScenes.length, color: "text-green-400" },
          { label: "Pending", value: pendingScenes.length, color: "text-amber-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-center">
            <p className={`text-xl font-black ${color}`}>{value}</p>
            <p className="text-[9px] text-white/30 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Per-scene status */}
      {scenes.length > 0 ? (
        <div className="space-y-1.5">
          {scenes.map((scene, i) => {
            const ce = settings.clips?.[scene.id];
            const status = ce?.lipSyncStatus ?? null;
            const enabled = !!ce?.useLipSync;
            return (
              <div key={scene.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.05] bg-white/[0.01]">
                <span className="text-[8px] font-mono text-white/20 w-5 shrink-0">{i + 1}</span>
                <span className="text-[10px] text-white/50 flex-1 truncate">{scene.section || `Scene ${i + 1}`}</span>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${
                  status === "done" ? "border-green-500/30 bg-green-500/10 text-green-400" :
                  status === "processing" ? "border-amber-500/30 bg-amber-500/10 text-amber-400" :
                  enabled ? "border-blue-500/30 bg-blue-500/10 text-blue-400" :
                  "border-white/10 text-white/20"
                }`}>
                  {status === "done" ? "✓ Done" :
                   status === "processing" ? "◷ Processing" :
                   enabled ? "Queued" : "—"}
                </span>
                {ce?.lipSyncOffsetSeconds !== undefined && ce.lipSyncOffsetSeconds !== 0 && (
                  <span className="text-[8px] font-mono text-violet-400/60">
                    +{ce.lipSyncOffsetSeconds.toFixed(2)}s
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-white/25 text-sm text-center py-4">No scenes loaded</p>
      )}

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="text-[10px] font-bold text-white/50 mb-2">Full Lip Sync Workflow</p>
        <p className="text-[9px] text-white/30 leading-relaxed mb-3">
          Submit scenes to Sync.so for AI lip sync, check job status, set timing offsets, and lock results. Full workflow available in the Legacy Editor.
        </p>
        <Link href={`/video-editor?project=${projectId}`}>
          <Button size="sm" variant="outline" className="border-white/10 text-white/60 gap-2 text-xs">
            <ExternalLink className="h-3.5 w-3.5" /> Open Lip Sync Studio
          </Button>
        </Link>
      </div>
    </div>
  );
}

/* ─── Panel: Captions ────────────────────────────────────────────────── */

function CaptionsPanel({ project, settings, setSettings, projectId, audioUrl }: StudioPanelProps) {
  const cap = settings.captions;

  const toggleCaptions = () => {
    setSettings({ ...settings, captions: { ...cap, enabled: !cap.enabled } });
  };

  const presets: { id: import("@/lib/editor-settings").CaptionStylePreset; label: string }[] = [
    { id: "clean-white",  label: "Clean White" },
    { id: "gold-hiphop",  label: "Gold Hip-Hop" },
    { id: "karaoke",      label: "Karaoke" },
    { id: "boxed",        label: "Boxed" },
    { id: "viral-shorts", label: "Viral Shorts" },
    { id: "minimal",      label: "Minimal" },
  ];

  return (
    <div className="space-y-5">
      <PanelHeading icon={AlignLeft} title="Captions"
        subtitle="AI captions · lyrics timing · caption style · burn into export"
        action={<LegacyEditorLink projectId={projectId} label="Full Caption Editor →" />} />

      {/* Quick toggle */}
      <div className="flex items-center justify-between px-3 py-3 rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <div>
          <p className="text-[11px] font-bold text-white">Captions in Export</p>
          <p className="text-[9px] text-white/30 mt-0.5">Burn captions into the final video</p>
        </div>
        <button type="button" onClick={toggleCaptions}
          className={`relative h-6 w-11 rounded-full transition-colors ${cap.enabled ? "bg-primary/70" : "bg-white/15"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${cap.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>

      {/* Style preset */}
      <div>
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-2">Caption Style Preset</p>
        <div className="grid grid-cols-3 gap-2">
          {presets.map(({ id, label }) => (
            <button key={id} type="button"
              onClick={() => setSettings({ ...settings, captions: { ...cap, stylePreset: id } })}
              className={`px-2 py-2 rounded-lg border text-[10px] font-bold transition-colors ${
                cap.stylePreset === id
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-white/[0.06] bg-white/[0.02] text-white/40 hover:border-white/15"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Caption mode */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-2">Caption Mode</p>
        <div className="space-y-1.5">
          {[
            { id: "auto"     as const, label: "Auto from Lyrics" },
            { id: "manual"   as const, label: "Manual Captions" },
            { id: "hook"     as const, label: "Hook Only" },
            { id: "none"     as const, label: "No Captions" },
          ].map(opt => (
            <button key={opt.id} type="button"
              onClick={() => setSettings({ ...settings, captions: { ...cap, mode: opt.id } })}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors ${
                cap.mode === opt.id
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-white/[0.05] text-white/40 hover:border-white/10"
              }`}>
              <span className={`h-3 w-3 rounded-full border shrink-0 ${cap.mode === opt.id ? "border-primary bg-primary" : "border-white/25"}`} />
              <span className="text-[10px] font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="text-[10px] font-bold text-white/50 mb-1.5">Full Captions Workflow</p>
        <p className="text-[9px] text-white/30 leading-relaxed mb-3">
          Edit caption timing, preview captions over video, sync to lyrics, and configure word-by-word karaoke styling in the Legacy Editor.
        </p>
        <Link href={`/video-editor?project=${projectId}`}>
          <Button size="sm" variant="outline" className="border-white/10 text-white/60 gap-2 text-xs">
            <ExternalLink className="h-3.5 w-3.5" /> Caption Editor
          </Button>
        </Link>
      </div>
    </div>
  );
}

/* ─── Panel: Effects ─────────────────────────────────────────────────── */

function EffectsPanel({ settings, projectId }: StudioPanelProps) {
  const activeOverlays = settings.overlays ?? [];
  const activeEffects  = settings.effects  ?? [];
  const transitions    = settings.transitions ?? [];
  const colorGrade     = settings.autoEditPlan?.notes?.match(/color[:\s]+(\w+)/i)?.[1] ?? null;

  return (
    <div className="space-y-5">
      <PanelHeading icon={Zap} title="Effects"
        subtitle="Visual filters · transitions · motion overlays · color grade"
        action={<LegacyEditorLink projectId={projectId} label="Full Effects Editor →" />} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <p className="text-[9px] text-white/25 uppercase tracking-widest mb-2">Active Overlays</p>
          {activeOverlays.length === 0 && activeEffects.length === 0 ? (
            <p className="text-[9px] text-white/20 italic">None active</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {[...activeOverlays, ...activeEffects].map(o => (
                <span key={o} className="text-[8px] px-1.5 py-0.5 rounded-full border border-primary/25 bg-primary/10 text-primary/70 font-mono">
                  {o}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <p className="text-[9px] text-white/25 uppercase tracking-widest mb-2">Transitions</p>
          <p className="text-xl font-black text-white/60">{transitions.length}</p>
          <p className="text-[8px] text-white/25">custom transition{transitions.length !== 1 ? "s" : ""} set</p>
        </div>
      </div>

      {/* Color grade from AI plan */}
      {colorGrade && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">AI Color Grade Plan</p>
          <p className="text-[11px] text-primary/70 font-bold capitalize">{colorGrade}</p>
        </div>
      )}

      {/* Overlay quality mode */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] text-white/25 uppercase tracking-widest mb-0.5">Overlay Quality</p>
            <p className="text-[11px] text-white/50 capitalize">{settings.overlayQualityMode || "subtle"}</p>
          </div>
          <p className="text-[8px] text-white/20">Edit in Legacy Editor</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="text-[10px] font-bold text-white/50 mb-1.5">Full Effects Workflow</p>
        <p className="text-[9px] text-white/30 leading-relaxed mb-3">
          Preview effects live on video, apply per-clip overrides, set film grain / VHS / neon glow intensity, and configure section-based effects in the Legacy Editor.
        </p>
        <Link href={`/video-editor?project=${projectId}`}>
          <Button size="sm" variant="outline" className="border-white/10 text-white/60 gap-2 text-xs">
            <ExternalLink className="h-3.5 w-3.5" /> Open Effects Editor
          </Button>
        </Link>
      </div>
    </div>
  );
}

/* ─── Panel: Overlays / Branding ─────────────────────────────────────── */

function OverlaysPanel({ project, settings, setSettings, projectId }: StudioPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeading icon={Layout} title="Overlays & Branding"
        subtitle="Watermark · intro/outro cards · artist name overlay · logo"
        action={<LegacyEditorLink projectId={projectId} label="Full Branding Editor →" />} />

      <div className="rounded-xl border border-white/[0.07] overflow-hidden">
        <BrandingSection
          settings={settings}
          setSettings={setSettings}
          artistName={project.artist_name ?? undefined}
          songTitle={project.song_title ?? undefined}
        />
      </div>
    </div>
  );
}

/* ─── Panel: Promo Clips ─────────────────────────────────────────────── */

function PromoPanel({ project, projectId }: StudioPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeading icon={Clapperboard} title="Promo Clips"
        subtitle="Short social media clips · hook export · format options" />

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "9:16 Story", desc: "TikTok / Reels", icon: "📱" },
          { label: "16:9 Landscape", desc: "YouTube / Twitter", icon: "🖥" },
          { label: "1:1 Square", desc: "Instagram Feed", icon: "⬛" },
        ].map(({ label, desc, icon }) => (
          <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-center">
            <div className="text-2xl mb-2">{icon}</div>
            <p className="text-[11px] font-bold text-white/60">{label}</p>
            <p className="text-[9px] text-white/25 mt-0.5">{desc}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="text-[10px] font-bold text-white/50 mb-1.5">Create Promo Clips</p>
        <p className="text-[9px] text-white/30 leading-relaxed mb-3">
          Generate short promo clips from your hook or outro. Choose format, set duration, and export to social media. Available in the dedicated Promo Clip Maker.
        </p>
        <div className="flex gap-2">
          <Link href="/promo-clip">
            <Button size="sm" className="gap-2 text-xs">
              <Clapperboard className="h-3.5 w-3.5" /> Open Promo Clip Maker
            </Button>
          </Link>
          <Link href={`/video-editor?project=${projectId}`}>
            <Button size="sm" variant="outline" className="border-white/10 text-white/60 gap-2 text-xs">
              <ExternalLink className="h-3.5 w-3.5" /> Legacy Editor
            </Button>
          </Link>
        </div>
      </div>

      {project.artist_name && (
        <div className="text-[9px] font-mono text-white/20">
          Project context: {project.artist_name} — {project.song_title ?? "Untitled"}
        </div>
      )}
    </div>
  );
}

/* ─── Panel: Thumbnail ───────────────────────────────────────────────── */

function ThumbnailPanel({ project, projectId }: StudioPanelProps) {
  return (
    <div className="space-y-5">
      <PanelHeading icon={ImageIcon} title="Thumbnail / Cover"
        subtitle="Generate AI thumbnail · upload cover · export cover art" />

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6 text-center">
        <ImageIcon className="h-10 w-10 text-white/10 mx-auto mb-4" />
        <p className="text-white/40 text-sm font-bold mb-1">Thumbnail Generator</p>
        <p className="text-[10px] text-white/25 max-w-xs mx-auto mb-4">
          Generate a professional AI thumbnail for your music video with artist name, song title, and cover art.
        </p>
        <Link href="/thumbnail">
          <Button className="gap-2">
            <ImageIcon className="h-4 w-4" /> Open Thumbnail Maker
          </Button>
        </Link>
      </div>

      {project.artist_name && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1">Project Context</p>
          <p className="text-[10px] text-white/50">{project.artist_name} — {project.song_title ?? "Untitled"}</p>
          {project.genre && <p className="text-[9px] text-white/30">{project.genre} · {project.mood ?? ""}</p>}
        </div>
      )}
    </div>
  );
}

/* ─── Panel: Export ──────────────────────────────────────────────────── */

function ExportPanel({ project, scenes, settings, projectId, getAccessToken, audioUrl, onTabChange }: StudioPanelProps) {
  const lockedTimeline = project.output_data?.lockedTimeline ?? null;

  const [exportState, setExportState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [exportMode, setExportMode] = useState<"test20s" | "full">("full");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  async function runExport(mode: "test20s" | "full") {
    if (!lockedTimeline) return;
    setExportMode(mode);
    setExportState("running");
    setResultUrl(null);
    setExportError(null);
    const isTest = mode === "test20s";
    setProgress(isTest ? "Preparing first 20s test…" : "Preparing full video render…");
    try {
      const token = await getAccessToken();
      const allClips = lockedTimeline.clips;
      const clipsForExport = isTest
        ? allClips.filter(c => c.url && c.startSec < 20)
        : allClips.filter(c => c.url);
      if (clipsForExport.length === 0) throw new Error("No valid clip URLs in locked timeline.");
      setProgress(`Rendering ${clipsForExport.length} clip${clipsForExport.length !== 1 ? "s" : ""}…`);
      const res = await fetch("/api/export-final-video", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          projectId, clipUrls: clipsForExport.map(c => c.url!),
          audioUrl: audioUrl ?? null, audioSource: audioUrl ? "uploaded" : "none",
          aspectRatio: "9:16",
          ...(isTest ? { exportRangeStart: 0, exportRangeEnd: 20 } : {}),
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => String(res.status));
        let msg = `Export failed (HTTP ${res.status})`;
        try { const j = JSON.parse(txt) as { error?: string; message?: string }; msg = j.message ?? j.error ?? msg; } catch {}
        throw new Error(msg);
      }
      const data = await res.json() as { finalVideoUrl?: string; url?: string };
      const url = data.finalVideoUrl ?? data.url ?? null;
      if (!url) throw new Error("Server returned no download URL");
      setResultUrl(url); setExportState("done"); setProgress("done");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Unknown export error");
      setExportState("error"); setProgress("error");
    }
  }

  const clipsReady = useMemo(() => scenes.filter(s => {
    const ce = settings.clips?.[s.id];
    return (ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl) || !!s.demoClipUrl;
  }).length, [scenes, settings]);

  return (
    <div className="space-y-5">
      <PanelHeading icon={Download} title="Export"
        subtitle="Export First 20s Test · Export Full Music Video · Legacy Export Doctor" />

      {/* Pre-export checklist */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-2">Export Readiness</p>
        {[
          { label: "Song audio loaded", ok: !!audioUrl, action: () => onTabChange("song") },
          { label: `Clips ready (${clipsReady}/${scenes.length})`, ok: clipsReady === scenes.length && scenes.length > 0, action: () => onTabChange("clips") },
          { label: "Timeline locked", ok: !!lockedTimeline, action: () => onTabChange("timeline") },
        ].map(({ label, ok, action }) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center shrink-0 ${ok ? "border-green-500/50 bg-green-500/20" : "border-white/20"}`}>
              {ok && <Check className="h-2 w-2 text-green-400" />}
            </span>
            <span className={`text-[10px] flex-1 ${ok ? "text-white/50" : "text-white/30"}`}>{label}</span>
            {!ok && (
              <button type="button" onClick={action} className="text-[9px] text-primary/60 hover:text-primary underline">Fix →</button>
            )}
          </div>
        ))}
      </div>

      {lockedTimeline ? (
        <div className="rounded-xl border border-green-500/20 bg-green-500/[0.03] overflow-hidden">
          <div className="px-3 py-2.5 flex items-center gap-2 border-b border-green-500/[0.08]">
            <Lock className="h-3.5 w-3.5 text-green-400 shrink-0" />
            <p className="text-[10px] font-black text-green-400 uppercase tracking-widest flex-1">
              Timeline Locked · {lockedTimeline.clipCount} clips
            </p>
            <span className="text-[8px] text-white/20 font-mono">{lockedTimeline.id}</span>
          </div>
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={exportState === "running"}
                onClick={() => void runExport("test20s")}
                className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] hover:bg-amber-500/10 px-3 py-2.5 text-left transition-colors disabled:opacity-50">
                <div className="flex items-center gap-1.5 mb-1">
                  {exportState === "running" && exportMode === "test20s"
                    ? <RefreshCw className="h-3 w-3 text-amber-400 animate-spin" />
                    : <Film className="h-3 w-3 text-amber-400" />}
                  <span className="text-[10px] font-bold text-amber-400">First 20s Test</span>
                </div>
                <p className="text-[8px] text-white/30">Quick test render</p>
              </button>
              <button type="button" disabled={exportState === "running"}
                onClick={() => void runExport("full")}
                className="rounded-lg border border-green-500/30 bg-green-500/[0.05] hover:bg-green-500/10 px-3 py-2.5 text-left transition-colors disabled:opacity-50">
                <div className="flex items-center gap-1.5 mb-1">
                  {exportState === "running" && exportMode === "full"
                    ? <RefreshCw className="h-3 w-3 text-green-400 animate-spin" />
                    : <Download className="h-3 w-3 text-green-400" />}
                  <span className="text-[10px] font-bold text-green-400">Full Video</span>
                </div>
                <p className="text-[8px] text-white/30">{lockedTimeline.clips.filter(c => c.url).length} clips · full song</p>
              </button>
            </div>
            {exportState === "running" && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02]">
                <RefreshCw className="h-3 w-3 text-white/40 animate-spin shrink-0" />
                <p className="text-[9px] text-white/50 font-mono">{progress}</p>
              </div>
            )}
            {exportState === "done" && resultUrl && (
              <a href={resultUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-green-500/30 bg-green-500/[0.08] text-green-400 hover:bg-green-500/15 transition-colors">
                <Download className="h-3.5 w-3.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold">Download {exportMode === "test20s" ? "First 20s Test" : "Full Video"}</p>
                  <p className="text-[8px] text-white/30 font-mono truncate mt-0.5">{resultUrl}</p>
                </div>
              </a>
            )}
            {exportState === "error" && exportError && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-red-500/25 bg-red-500/[0.05]">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-red-400 font-mono leading-relaxed">{exportError}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-center">
          <Lock className="h-8 w-8 text-white/10 mx-auto mb-3" />
          <p className="text-white/40 font-bold text-sm mb-1">Timeline Not Locked</p>
          <p className="text-[10px] text-white/25 mb-3">Lock the timeline in the Timeline tab to generate the export blueprint.</p>
          <button type="button" onClick={() => onTabChange("timeline")}
            className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary text-[11px] font-bold hover:bg-primary/20 transition-colors">
            <Layers className="h-3.5 w-3.5" /> Open Timeline
          </button>
        </div>
      )}

      {/* Legacy Export Doctor */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] px-3 py-3">
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-1.5">Advanced / Legacy Export Doctor</p>
        <p className="text-[9px] text-white/25 mb-2.5 leading-relaxed">
          For detailed diagnostics, clip-by-clip validation, custom export settings (captions, branding, overlays, format), and the full Export Doctor debug panel.
        </p>
        <Link href={`/video-editor?project=${projectId}`}>
          <Button size="sm" variant="outline" className="border-white/10 text-white/50 gap-2 text-xs">
            <ExternalLink className="h-3.5 w-3.5" /> Open Legacy Export Doctor
          </Button>
        </Link>
      </div>
    </div>
  );
}

/* ─── Panel: Credits ─────────────────────────────────────────────────── */

function CreditsPanel({ project, projectId }: StudioPanelProps) {
  const { profile } = useAuth();
  const currentCredits = profile?.credits ?? 0;

  const costEstimate = {
    clip: 5,
    export: 5,
    lipSync: 3,
  };

  return (
    <div className="space-y-5">
      <PanelHeading icon={CreditCard} title="Credits & Costs"
        subtitle="Credit balance · generation costs · export costs · history" />

      {/* Credit balance */}
      <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-5 text-center">
        <p className="text-[9px] text-primary/50 uppercase tracking-widest mb-1">Current Balance</p>
        <p className="text-4xl font-black text-primary">{currentCredits}</p>
        <p className="text-[10px] text-white/30 mt-1">credits remaining</p>
        <Link href="/pricing">
          <Button size="sm" className="mt-3 gap-2 text-xs">
            <Star className="h-3.5 w-3.5" /> Buy More Credits
          </Button>
        </Link>
      </div>

      {/* Project usage */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-3">This Project</p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">Credits used on this project</span>
          <span className="text-sm font-black text-white/60">{project.credits_used}</span>
        </div>
      </div>

      {/* Cost estimates */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
        <p className="text-[9px] text-white/25 uppercase tracking-widest mb-2">Cost Estimates</p>
        {[
          { label: "Generate AI clip (Runway)", cost: costEstimate.clip },
          { label: "Final video export (FFmpeg)", cost: costEstimate.export },
          { label: "Lip sync scene (Sync.so)", cost: costEstimate.lipSync },
        ].map(({ label, cost }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-[10px] text-white/40">{label}</span>
            <span className="text-[10px] font-mono text-primary/60">{cost} credit{cost !== 1 ? "s" : ""}</span>
          </div>
        ))}
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-2">
        <Link href="/credit-history">
          <Button variant="outline" size="sm" className="border-white/10 text-white/50 gap-2 text-xs">
            <Clock className="h-3.5 w-3.5" /> Credit History
          </Button>
        </Link>
        <Link href="/pricing">
          <Button variant="outline" size="sm" className="border-white/10 text-white/50 gap-2 text-xs">
            <CreditCard className="h-3.5 w-3.5" /> Pricing Plans
          </Button>
        </Link>
      </div>
    </div>
  );
}

/* ─── Sidebar ────────────────────────────────────────────────────────── */

function StudioSidebar({
  activeTab, setActiveTab, isLocked, clipsReady, totalClips, audioReady,
}: {
  activeTab: StudioTab;
  setActiveTab: (t: StudioTab) => void;
  isLocked: boolean;
  clipsReady: number;
  totalClips: number;
  audioReady: boolean;
}) {
  function statusDot(tab: StudioTab): React.ReactNode {
    const size = "h-1.5 w-1.5 rounded-full shrink-0";
    if (tab === "song") return audioReady ? <span className={`${size} bg-green-500`} /> : <span className={`${size} bg-amber-500/70`} />;
    if (tab === "clips") return (
      clipsReady === totalClips && totalClips > 0
        ? <span className={`${size} bg-green-500`} />
        : totalClips > 0 ? <span className={`${size} bg-amber-500/70`} /> : null
    );
    if (tab === "timeline") return isLocked ? <span className={`${size} bg-green-500`} /> : null;
    if (tab === "export") return isLocked ? <span className={`${size} bg-primary`} /> : null;
    return null;
  }

  return (
    <div className="w-48 shrink-0 bg-[#050505] border-r border-white/[0.06] flex flex-col h-full">
      <div className="flex-1 overflow-y-auto py-2">
        {TAB_CONFIG.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          const dot = statusDot(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors group ${
                isActive
                  ? "bg-primary/10 border-r-2 border-primary text-primary"
                  : "text-white/35 hover:text-white/70 hover:bg-white/[0.03]"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-primary" : "text-white/25 group-hover:text-white/50"}`} />
              <span className="text-[11px] font-medium flex-1">{t.label}</span>
              {dot}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Mini Player (bottom of sidebar) ───────────────────────────────── */

function MiniPlayer({
  audioUrl, currentTime, audioDuration, isPlaying,
  onTogglePlay, onRestart, onSeek, muted, onMuteToggle,
}: {
  audioUrl: string | null; currentTime: number; audioDuration: number | null;
  isPlaying: boolean; onTogglePlay: () => void; onRestart: () => void;
  onSeek: (s: number) => void; muted: boolean; onMuteToggle: () => void;
}) {
  if (!audioUrl) return (
    <div className="border-t border-white/[0.05] px-3 py-2.5">
      <p className="text-[8px] text-white/15 text-center">No audio loaded</p>
    </div>
  );

  return (
    <div className="border-t border-white/[0.05] px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onRestart}
            className="p-1 text-white/20 hover:text-white/60 transition-colors">
            <SkipBack className="h-3 w-3" />
          </button>
          <button type="button" onClick={onTogglePlay}
            className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors">
            {isPlaying ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5 ml-0.5" />}
          </button>
          <button type="button" onClick={onMuteToggle}
            className="p-1 text-white/20 hover:text-white/60 transition-colors">
            {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
        </div>
        <span className="text-[8px] font-mono text-white/25">
          {fmt(currentTime)} / {audioDuration ? fmt(audioDuration) : "--:--"}
        </span>
      </div>
      <div className="h-0.5 bg-white/[0.06] rounded-full overflow-hidden cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - rect.left) / rect.width) * (audioDuration ?? 0));
        }}>
        <div className="h-full bg-primary/50 rounded-full transition-none"
          style={{ width: audioDuration && audioDuration > 0 ? `${(currentTime / audioDuration) * 100}%` : "0%" }} />
      </div>
    </div>
  );
}

/* ─── Main StudioPage ────────────────────────────────────────────────── */

export default function StudioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user, profile, getAccessToken } = useAuth();
  const { activeArtist } = useActiveArtist();

  const [activeTab, setActiveTab] = useState<StudioTab>("overview");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [project, setProject] = useState<LoadedProject | null>(null);
  const [scenes, setScenes] = useState<SceneData[]>([]);
  const [settings, setSettings] = useState<EditorSettings>(normalizeEditorSettings(null));

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  const audioUrl: string | null =
    (project?.input_data?.["audioUrl"] as string | undefined) ??
    (project?.input_data?.["audio_url"] as string | undefined) ??
    null;

  /* ── Load project ── */
  useEffect(() => {
    if (!user || !projectId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setLoadError(null);
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/projects/${projectId}`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        if (!res.ok) throw new Error(res.status === 404 ? "Project not found" : "Failed to load project");
        const data = (await res.json()) as { project: LoadedProject };
        if (cancelled) return;
        setProject(data.project);
        const saved = data.project.output_data?.scenes ?? [];
        if (saved.length > 0) {
          setScenes(saved);
        } else if (data.project.output_data?.result) {
          const { scenes: parsed } = parseScenesWithMode(
            extractBreakdownContent(data.project.output_data.result) ?? data.project.output_data.result
          );
          setScenes(parsed);
        }
        setSettings(normalizeEditorSettings(data.project.output_data?.editorSettings));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, projectId, getAccessToken]);

  /* ── Audio events ── */
  const handleTimeUpdate = useCallback(() => { if (audioRef.current) setCurrentTime(audioRef.current.currentTime); }, []);
  const handleDurationChange = useCallback(() => { if (audioRef.current) setAudioDuration(audioRef.current.duration || null); }, []);
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleEnded = useCallback(() => setIsPlaying(false), []);

  /* ── Transport ── */
  const seekTo = useCallback((sec: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(audioDuration ?? sec, sec));
    setCurrentTime(audioRef.current.currentTime);
  }, [audioDuration]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else void audioRef.current.play();
  }, [isPlaying]);

  const restart = useCallback(() => { seekTo(0); }, [seekTo]);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = !muted;
    setMuted(m => !m);
  }, [muted]);

  /* ── Derived ── */
  const clipsReady = useMemo(() => scenes.filter(s => {
    const ce = settings.clips?.[s.id];
    return (ce?.useLipSync && ce.lipSyncStatus === "done" && ce.lipSyncUrl) || !!s.demoClipUrl;
  }).length, [scenes, settings]);

  const isLocked = !!project?.output_data?.lockedTimeline;

  /* ── Panel props ── */
  const panelProps: StudioPanelProps = {
    project: project!,
    scenes,
    setScenes,
    settings,
    setSettings,
    projectId: projectId ?? "",
    getAccessToken,
    audioUrl,
    currentTime,
    audioDuration,
    isPlaying,
    onSeek: seekTo,
    onTogglePlay: togglePlay,
    onRestart: restart,
    onTabChange: setActiveTab,
  };

  /* ── Loading/error ── */
  if (!user) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <p className="text-white/50 text-sm">Please sign in to use the Studio Editor.</p>
    </div>
  );

  if (loading) return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="border-b border-white/[0.07] bg-[#080808] px-4 py-3 flex items-center gap-3">
        <Link href="/my-projects">
          <button type="button" className="flex items-center gap-1.5 text-white/30 hover:text-white/70 text-sm">
            <ArrowLeft className="h-4 w-4" /> My Projects
          </button>
        </Link>
        <span className="text-white/15">·</span>
        <span className="text-[10px] font-bold text-primary/50 uppercase tracking-widest">Bow Down Studio Editor</span>
      </div>
      <div className="flex-1 flex items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <p className="text-white/40 text-sm">Loading project…</p>
      </div>
    </div>
  );

  if (loadError || !project) return (
    <div className="min-h-screen bg-black flex flex-col">
      <div className="border-b border-white/[0.07] bg-[#080808] px-4 py-3">
        <Link href="/my-projects">
          <button type="button" className="flex items-center gap-1.5 text-white/30 hover:text-white/70 text-sm">
            <ArrowLeft className="h-4 w-4" /> My Projects
          </button>
        </Link>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-white/60">{loadError ?? "Project not found"}</p>
        <Link href="/my-projects"><Button variant="outline">← Back to Projects</Button></Link>
      </div>
    </div>
  );

  const displayTitle = [project.artist_name, project.song_title].filter(Boolean).join(" — ") || project.title;

  function renderPanel() {
    if (!project) return null;
    const p = panelProps;
    switch (activeTab) {
      case "overview":   return <OverviewPanel  {...p} />;
      case "song":       return <SongPanel      {...p} />;
      case "lyrics":     return <LyricsPanel    {...p} />;
      case "artist":     return <ArtistPanel    {...p} />;
      case "clips":      return <ClipsPanel     {...p} />;
      case "timeline":   return <TimelinePanel  {...p} />;
      case "lipsync":    return <LipSyncPanel   {...p} />;
      case "captions":   return <CaptionsPanel  {...p} />;
      case "effects":    return <EffectsPanel   {...p} />;
      case "overlays":   return <OverlaysPanel  {...p} />;
      case "promo":      return <PromoPanel     {...p} />;
      case "thumbnail":  return <ThumbnailPanel {...p} />;
      case "export":     return <ExportPanel    {...p} />;
      case "credits":    return <CreditsPanel   {...p} />;
      default:           return null;
    }
  }

  return (
    <div className="h-screen bg-black flex flex-col overflow-hidden">
      {/* Hidden audio element — master clock */}
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="metadata" crossOrigin="anonymous"
          onTimeUpdate={handleTimeUpdate} onDurationChange={handleDurationChange}
          onPlay={handlePlay} onPause={handlePause} onEnded={handleEnded} />
      )}

      {/* Top bar */}
      <div className="border-b border-white/[0.07] bg-[#080808] px-4 py-2.5 flex items-center gap-3 shrink-0 z-30">
        <Link href="/my-projects">
          <button type="button" className="flex items-center gap-1.5 text-white/30 hover:text-white/70 transition-colors text-[11px]">
            <ArrowLeft className="h-3.5 w-3.5" /> Projects
          </button>
        </Link>
        <span className="text-white/10">·</span>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] text-primary/50 font-bold uppercase tracking-widest">✦ Bow Down Studio Editor</p>
          <h1 className="text-[13px] font-black text-white truncate leading-tight">{displayTitle}</h1>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isLocked && (
            <span className="text-[8px] font-bold px-2 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400">
              ✓ Timeline Locked
            </span>
          )}
          <Link href={`/video-editor?project=${projectId}`}>
            <Button variant="outline" size="sm" className="border-white/10 text-white/40 hover:text-white/70 text-[11px] h-7 px-2.5">
              Legacy Editor
            </Button>
          </Link>
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar */}
        <div className="w-48 shrink-0 bg-[#050505] border-r border-white/[0.06] flex flex-col overflow-hidden">
          {/* Tab list */}
          <div className="flex-1 overflow-y-auto py-1">
            {TAB_CONFIG.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              // Status dots
              let dot: React.ReactNode = null;
              if (t.id === "song" && audioUrl) dot = <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />;
              if (t.id === "song" && !audioUrl) dot = <span className="h-1.5 w-1.5 rounded-full bg-amber-500/70 shrink-0" />;
              if (t.id === "clips" && scenes.length > 0) dot = (
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${clipsReady === scenes.length ? "bg-green-500" : "bg-amber-500/70"}`} />
              );
              if (t.id === "timeline" && isLocked) dot = <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />;
              if (t.id === "export" && isLocked) dot = <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />;
              return (
                <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    isActive
                      ? "bg-primary/10 border-r-2 border-primary"
                      : "hover:bg-white/[0.03]"
                  }`}>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-primary" : "text-white/25"}`} />
                  <span className={`text-[11px] font-medium flex-1 truncate ${isActive ? "text-primary" : "text-white/35"}`}>
                    {t.label}
                  </span>
                  {dot}
                </button>
              );
            })}
          </div>

          {/* Mini player */}
          <MiniPlayer
            audioUrl={audioUrl}
            currentTime={currentTime}
            audioDuration={audioDuration}
            isPlaying={isPlaying}
            onTogglePlay={togglePlay}
            onRestart={restart}
            onSeek={seekTo}
            muted={muted}
            onMuteToggle={toggleMute}
          />
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-5 py-5">
            {renderPanel()}
          </div>
        </div>
      </div>
    </div>
  );
}
