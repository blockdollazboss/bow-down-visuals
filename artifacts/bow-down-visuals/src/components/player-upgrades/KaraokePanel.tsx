import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mic, Square, Upload } from "lucide-react";
import { activeLyricIndex, formatLyricTime, type TimedLyricLine } from "@/lib/karaoke";
import { r2UploadFile } from "@/lib/r2-storage";

/* ─── Karaoke Mode (N9) ───
   Interactive in-player sing-along on the song's own track: synced lit
   lyrics (the artist's own timed lyrics), the fan sings over it on their
   mic, and the take can be saved — shared as a house showcase song ONLY
   when the creator allows shares. The mic take is the fan's own voice;
   nothing is synthesized or faked. */

interface KaraokeState {
  enabled: boolean;
  shareEnabled: boolean;
  isOwner: boolean;
  hasTimedLyrics: boolean;
  lines: TimedLyricLine[];
}

interface RecordingRow {
  id: string;
  audio_url: string;
  status: string;
  created_at: string;
}

export function KaraokePanel({ songId, audioUrl, title, isLight }: {
  songId: string;
  audioUrl: string;
  title: string;
  isLight: boolean;
}) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<KaraokeState | null>(null);
  const [recordings, setRecordings] = useState<RecordingRow[]>([]);
  const [now, setNow] = useState(0);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [share, setShare] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [lyricsDraft, setLyricsDraft] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  const authFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getAccessToken();
    if (!token) return null;
    return fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
  }, [getAccessToken]);

  const load = useCallback(async () => {
    const res = await authFetch(`/api/songs/${songId}/karaoke`);
    if (res?.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.karaoke) setState(d.karaoke);
    }
    const rRes = await authFetch(`/api/songs/${songId}/karaoke/recordings`);
    if (rRes?.ok) {
      const d = await rRes.json().catch(() => ({}));
      setRecordings(Array.isArray(d.recordings) ? d.recordings : []);
    }
  }, [authFetch, songId]);

  useEffect(() => {
    if (open && !state) void load();
  }, [open, state, load]);

  const activeIdx = state ? activeLyricIndex(state.lines, now) : -1;

  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  async function saveSettings(patch: { enabled?: boolean; shareEnabled?: boolean; timedLyrics?: string }) {
    setSettingsBusy(true);
    try {
      const res = await authFetch(`/api/songs/${songId}/karaoke-settings`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      const data = await res?.json().catch(() => ({}));
      if (!res || !res.ok) {
        const detail = Array.isArray(data?.errors) ? data.errors.join(" ") : data?.error;
        throw new Error(detail || "Settings didn't save.");
      }
      toast({ title: "Karaoke settings saved" });
      setState(null);
      await load();
    } catch (err) {
      toast({ title: "That didn't save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSettingsBusy(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void finishRecording();
      recorder.start();
      setRecording(true);
      /* Sing along WITH the track — restart it so the take lines up. */
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        void audioRef.current.play().catch(() => {});
      }
    } catch {
      toast({ title: "Microphone unavailable", description: "Karaoke needs mic access to record your sing-along.", variant: "destructive" });
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  }

  async function finishRecording() {
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" });
    if (blob.size === 0) return;
    setSaving(true);
    try {
      const token = await getAccessToken();
      const publicUrl = await r2UploadFile(
        `karaoke-singalongs/${songId}/${Date.now()}.webm`,
        blob,
        blob.type || "audio/webm",
        token,
      );
      const res = await authFetch(`/api/songs/${songId}/karaoke/recordings`, {
        method: "POST",
        body: JSON.stringify({ audioUrl: publicUrl, share }),
      });
      const data = await res?.json().catch(() => ({}));
      if (!res || !res.ok) throw new Error(data?.error || "The take didn't save.");
      toast({ title: share ? "Sing-along shared to the showcase" : "Sing-along saved to your recordings" });
      await load();
    } catch (err) {
      toast({ title: "Take not saved", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const cardCls = isLight
    ? "border-[#C9A84C]/40 bg-[#FCF7EA]"
    : "border-primary/25 bg-black/40";
  const textDim = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors ${isLight ? "text-[#7A5A12] hover:text-[#2A1E07]" : "text-[#e8c86a]/80 hover:text-[#e8c86a]"}`}
      >
        <Mic className="h-3.5 w-3.5" /> Karaoke Mode
      </button>

      {open && (
        <div className={`mt-2 rounded-xl border p-4 space-y-4 ${cardCls}`}>
          {!state ? (
            <p className={`flex items-center gap-2 text-sm ${textDim}`}>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading karaoke…
            </p>
          ) : (
            <>
              {state.isOwner && (
                <div className="space-y-3">
                  <p className={`text-xs font-bold uppercase tracking-wider ${textDim}`}>Your karaoke settings</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={state.enabled ? "default" : "outline"}
                      disabled={settingsBusy}
                      onClick={() => void saveSettings({ enabled: !state.enabled })}
                      className="text-xs"
                    >
                      {state.enabled ? "Karaoke: ON" : "Karaoke: OFF"}
                    </Button>
                    <Button
                      size="sm"
                      variant={state.shareEnabled ? "default" : "outline"}
                      disabled={settingsBusy}
                      onClick={() => void saveSettings({ shareEnabled: !state.shareEnabled })}
                      className="text-xs"
                    >
                      {state.shareEnabled ? "Fan shares: allowed" : "Fan shares: off"}
                    </Button>
                  </div>
                  <div>
                    <label className={`text-[11px] font-bold uppercase tracking-wider ${textDim}`}>
                      Timed lyrics (LRC — one [m:ss] line at a time, your song's own words)
                    </label>
                    <textarea
                      value={lyricsDraft}
                      onChange={(e) => setLyricsDraft(e.target.value)}
                      placeholder={"[0:05] First line of your song\n[0:12] Second line"}
                      rows={4}
                      maxLength={20000}
                      className="mt-1 w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-sm placeholder:text-white/25 focus:border-[#e8c86a]/50 focus:outline-none resize-y"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={settingsBusy || !lyricsDraft.trim()}
                      onClick={() => void saveSettings({ timedLyrics: lyricsDraft })}
                      className="mt-2 text-xs gap-2"
                    >
                      <Upload className="h-3.5 w-3.5" /> Save timed lyrics
                    </Button>
                    {!state.hasTimedLyrics && (
                      <p className={`mt-2 text-xs ${textDim}`}>Karaoke needs timed lyrics on file before it can turn on.</p>
                    )}
                  </div>
                </div>
              )}

              {!state.enabled ? (
                <p className={`text-sm ${textDim}`}>
                  {state.isOwner
                    ? "Karaoke Mode is off for this song. Add timed lyrics above, then turn it on."
                    : "Karaoke Mode isn't on for this song."}
                </p>
              ) : (
                <>
                  <audio
                    ref={audioRef}
                    controls
                    src={audioUrl}
                    className="w-full h-9"
                    onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                  />
                  <div className="max-h-44 overflow-y-auto rounded-lg bg-black/30 px-4 py-3 space-y-1.5 text-center">
                    {state.lines.map((line, i) => (
                      <p
                        key={`${line.startSec}-${i}`}
                        ref={i === activeIdx ? activeLineRef : undefined}
                        className={`text-sm transition-all ${
                          i === activeIdx
                            ? "text-[#e8c86a] font-bold text-base"
                            : i < activeIdx
                              ? isLight ? "text-[#8A7A56]" : "text-white/35"
                              : isLight ? "text-[#2A1E07]" : "text-white/70"
                        }`}
                      >
                        <span className="mr-2 text-[10px] opacity-60">{formatLyricTime(line.startSec)}</span>
                        {line.text}
                      </p>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {!recording ? (
                      <Button
                        size="sm"
                        disabled={saving}
                        onClick={() => void startRecording()}
                        className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-xs gap-2"
                      >
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
                        Sing along — record my take
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={stopRecording} className="text-xs gap-2">
                        <Square className="h-3.5 w-3.5" /> Stop & save my take
                      </Button>
                    )}
                    {state.shareEnabled && !recording && (
                      <label className={`flex items-center gap-2 text-xs ${textDim}`}>
                        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
                        Share my take to the showcase (the creator allows it)
                      </label>
                    )}
                  </div>
                  <p className={`text-[11px] ${textDim}`}>
                    Your take for “{title}” is your own voice from your mic — recorded as you sing over the track.
                  </p>
                  {recordings.length > 0 && (
                    <div className="space-y-2">
                      <p className={`text-xs font-bold uppercase tracking-wider ${textDim}`}>My takes on this song</p>
                      {recordings.map((r) => (
                        <div key={r.id} className="flex items-center gap-3">
                          <audio controls src={r.audio_url} className="h-7 flex-1" />
                          <span className={`text-[11px] ${textDim}`}>{r.status === "shared" ? "Shared" : "Private"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
