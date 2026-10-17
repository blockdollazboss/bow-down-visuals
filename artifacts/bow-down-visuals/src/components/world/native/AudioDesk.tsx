import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CreateDeskRunner, type CreateDeskJobState } from "./CreateDeskRunner";
import {
  ABAudioPlayer,
  AdvancedExpander,
  AudioResult,
  DeskSelectField,
  DeskTextField,
  QuestProgressChip,
  ResultChips,
  useDeskAuthHeaders,
  useQuestProgressChip,
} from "./CreateDeskShared";
import {
  AUDIO_BENCHES,
  audioBenchJobIdOf,
  audioBenchOf,
  buildHarmonyPayload,
  buildPodcastPayload,
  buildSingingVoicePayload,
  buildVocalPolishPayload,
  buildVoiceoverPayload,
  interpretAudioBenchResponse,
  lufsNormalizeFields,
  masterFields,
  MASTER_FILE_FIELD,
  mixFields,
  MIX_STEMS_FIELD,
  quickMasterFields,
  rateMyMixFields,
  RATE_MY_MIX_FILE_FIELD,
  stemsFields,
  vocalTuneFields,
  type AudioBenchId,
  type AudioBenchResult,
} from "@/lib/world/audio-benches";
import {
  fetchServerArrangement,
  saveServerArrangement,
  type Arrangement,
} from "@/lib/arrangement";
import {
  humAnalysisOfResponse,
  humAnalyzeFields,
  HUM_FORM_FIELD,
  humGenerateFields,
  humSongUrlOfResponse,
} from "@/lib/world/create-desks";
import type { CreateDeskProps } from "./CreateDesks";
import {
  audioCleanupCost,
  beatCost,
  buildBeatPayload,
  buildEditorProjectPayload,
  buildSfxPayload,
  deverbCost,
  finishMySongCost,
  interpretJobPoll,
  sfxCost,
} from "@/lib/world/create-desks";
import {
  fetchLibrarySongFile,
  fetchLibrarySongs,
  formatSongDuration,
  type LibrarySong,
} from "@/lib/song-library";

/* ─── Audio Studio Desk — the QUICK BENCH (NATIVE-PLAN §3.6) ───────
   Pick a song or file, then one bench action: clean it up, de-reverb
   it, or finish it — plus the two small generators (beats, sound
   effects). Each rides the exact endpoint, form shape, poll rhythm
   and price its Audio Studio / AI Audio page uses. The full
   multi-tool audio workbench (mix/master, stems, arrangement, voice
   benches) is deliberately NOT here — it is a named native
   follow-on, and the desk's transfer footer reaches it meanwhile. */

type BenchTool = "cleanup" | "deverb" | "finish" | "beat" | "sfx";

const TOOL_LABELS: Record<BenchTool, string> = {
  cleanup: "Clean up",
  deverb: "De-reverb",
  finish: "Finish my song",
  beat: "Beat",
  sfx: "Sound effect",
};

function toolCost(tool: BenchTool): number {
  switch (tool) {
    case "cleanup":
      return audioCleanupCost();
    case "deverb":
      return deverbCost();
    case "finish":
      return finishMySongCost();
    case "beat":
      return beatCost();
    case "sfx":
      return sfxCost();
  }
}

export function AudioDesk(props: CreateDeskProps) {
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const [tool, setTool] = useState<BenchTool>("cleanup");
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceSongId, setSourceSongId] = useState<string | null>(null);
  const [songs, setSongs] = useState<LibrarySong[] | null>(null);
  const [songsFailed, setSongsFailed] = useState(false);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const [cleanupMode, setCleanupMode] = useState("voice");
  const [deverbMode, setDeverbMode] = useState("dialogue");
  const [notes, setNotes] = useState("");
  const [beatGenre, setBeatGenre] = useState("trap");
  /* Ring 2 (2.8): the beat bench's numbers, surfaced — the page's
     defaults (140 BPM, key C, 60 seconds) are the starting values,
     never a silent post again. */
  const [beatBpm, setBeatBpm] = useState(140);
  const [beatKey, setBeatKey] = useState("C");
  const [beatLength, setBeatLength] = useState(60);
  const [beatTitle, setBeatTitle] = useState("");
  const [pickedSong, setPickedSong] = useState<LibrarySong | null>(null);
  const quest = useQuestProgressChip();
  const [sfxCategory, setSfxCategory] = useState("impacts");
  const [state, setState] = useState<CreateDeskJobState>("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultTitle, setResultTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [gateNote, setGateNote] = useState<string | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isFileTool = tool === "cleanup" || tool === "deverb" || tool === "finish";

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stopPolling, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchLibrarySongs(getAccessToken);
        if (!cancelled) setSongs(list);
      } catch {
        if (!cancelled) setSongsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* De-reverb's server gate, read the way DeverbPanel reads it. */
  useEffect(() => {
    if (tool !== "deverb") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/deverb/status");
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
        if (!cancelled && res.ok && data.ok === false) {
          setGateNote(data.message ?? "De-reverb isn't switched on yet — nothing will be charged.");
        } else if (!cancelled) {
          setGateNote(null);
        }
      } catch {
        if (!cancelled) setGateNote(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tool]);

  const pickSong = async (song: LibrarySong) => {
    setPickingId(song.id);
    try {
      const picked = await fetchLibrarySongFile(song);
      setFile(picked);
      setPickedSong(song);
      setSourceSongId(song.id);
      setPrompt(song.title);
      setError(null);
    } catch {
      setError("Couldn't fetch that song's audio — try again or upload the file instead.");
    } finally {
      setPickingId(null);
    }
  };

  const startJobPoll = (basePath: string, jobId: string, doneTitle: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${basePath}/${jobId}`, { headers: await authHeaders() });
        const data = (await res.json().catch(() => ({}))) as Parameters<typeof interpretJobPoll>[0];
        const read = interpretJobPoll(data);
        if (read.done) {
          stopPolling();
          if (read.failed) {
            setError(read.error ?? "The job didn't finish.");
            setState("failed");
          } else {
            setResultUrl(read.url);
            setResultTitle(doneTitle);
            refreshProfile();
            setState("done");
            void quest.checkAfter();
          }
        }
      } catch {
        /* keep polling on transient network errors, as the pages do */
      }
    }, 3000);
  };

  const run = async () => {
    if (state === "running") return;
    if (isFileTool && !file) {
      setError("Pick a song from your library or upload a file first — the bench works on your audio.");
      setState("failed");
      return;
    }
    if (!isFileTool && !prompt.trim()) return;
    setState("running");
    setError(null);
    setResultUrl(null);
    void quest.snapshot();
    try {
      if (tool === "cleanup" || tool === "deverb") {
        const form = new FormData();
        form.append("audio", file!);
        form.append("mode", tool === "cleanup" ? cleanupMode : deverbMode);
        if (tool === "cleanup" && sourceSongId) form.append("sourceSongId", sourceSongId);
        const path = tool === "cleanup" ? "/api/audio-cleanup" : "/api/deverb";
        const res = await fetch(path, { method: "POST", headers: await authHeaders(), body: form });
        const data = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string; message?: string };
        if (res.status === 402 && data.error === "pricing_pending") {
          throw new Error(data.message ?? "De-reverb pricing hasn't been approved yet — nothing was charged.");
        }
        if (!res.ok || !data.jobId) throw new Error(data.message || data.error || "The job didn't start.");
        startJobPoll(path, data.jobId, tool === "cleanup" ? "Your cleaned audio" : "Your de-reverbed audio");
        return;
      }
      if (tool === "finish") {
        const form = new FormData();
        form.append("demo", file!);
        form.append("notes", notes.trim());
        if (sourceSongId) form.append("sourceSongId", sourceSongId);
        const res = await fetch("/api/finish-my-song/complete", {
          method: "POST",
          headers: await authHeaders(),
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as { songUrl?: string; error?: string; message?: string };
        if (!res.ok || !data.songUrl) throw new Error(data.message || data.error || "Could not finish the song.");
        setResultUrl(data.songUrl);
        setResultTitle("Your finished song");
        refreshProfile();
        setState("done");
        void quest.checkAfter();
        return;
      }
      const isBeat = tool === "beat";
      const res = await fetch(isBeat ? "/api/beat/generate" : "/api/generate-sfx", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          isBeat
            ? buildBeatPayload(prompt, {
                genre: beatGenre,
                bpm: beatBpm,
                musicalKey: beatKey,
                lengthSeconds: beatLength,
                title: beatTitle,
              })
            : buildSfxPayload(prompt, { category: sfxCategory }),
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(data.message || data.error || "Generation failed.");
      setResultUrl(data.url);
      setResultTitle(isBeat ? "Your beat" : "Your sound effect");
      refreshProfile();
      setState("done");
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The bench hit a snag.");
      setState("failed");
    }
  };

  const sendToEditor = async () => {
    if (!props.onOpenEditor || !resultUrl || editorBusy) return;
    setEditorBusy(true);
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          buildEditorProjectPayload({
            projectType: "Audio Studio",
            title: resultTitle || prompt || "Audio Studio bench",
            inputData: { tool, prompt },
            resultText: resultUrl,
          }),
        ),
      });
    } catch {
      /* best-effort seed — the step-through still opens */
    } finally {
      setEditorBusy(false);
      props.onOpenEditor();
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <div className="space-y-3" data-testid="world-create-audio-desk">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Audio bench tools">
        {(Object.keys(TOOL_LABELS) as BenchTool[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tool === t}
            data-testid={`world-create-audio-tool-${t}`}
            onClick={() => {
              setTool(t);
              setState("idle");
              setResultUrl(null);
              setError(null);
            }}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              tool === t
                ? "border-[#d4af37] bg-[#d4af37] text-black"
                : isLight
                  ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                  : "border-white/15 text-white/75 hover:text-white"
            }`}
          >
            {TOOL_LABELS[t]} · {toolCost(t).toLocaleString("en-US")} VB
          </button>
        ))}
      </div>

      {isFileTool && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
              }`}
            >
              {file ? `File: ${file.name}` : "Upload a song or file"}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFile(f);
                    setSourceSongId(null);
                    if (!prompt) setPrompt(f.name.replace(/\.[^.]+$/, ""));
                  }
                }}
              />
            </label>
            {state === "running" && <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" />}
          </div>
          {songsFailed ? (
            <p className={`text-xs ${muted}`}>Your song library wouldn&rsquo;t open — uploading a file still works.</p>
          ) : songs === null ? (
            <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Opening your song library…
            </p>
          ) : songs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {songs.slice(0, 8).map((song) => (
                <button
                  key={song.id}
                  type="button"
                  data-testid="world-create-audio-library-pick"
                  disabled={pickingId !== null}
                  onClick={() => void pickSong(song)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                    sourceSongId === song.id
                      ? "border-[#d4af37] bg-[#d4af37]/15"
                      : isLight
                        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                        : "border-white/15 text-white/75 hover:text-white"
                  }`}
                >
                  {song.title}
                  {formatSongDuration(song.durationSec) ? ` · ${formatSongDuration(song.durationSec)}` : ""}
                </button>
              ))}
            </div>
          ) : (
            <p className={`text-xs ${muted}`}>No songs in your library yet — upload a file to use the bench.</p>
          )}
          {gateNote && tool === "deverb" ? (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{gateNote}</p>
          ) : null}
        </div>
      )}

      <AdvancedExpander isLight={isLight}>
        {tool === "cleanup" && (
          <DeskSelectField
            isLight={isLight}
            label="Cleanup mode"
            value={cleanupMode}
            onChange={setCleanupMode}
            options={[
              { value: "voice", label: "Voice" },
              { value: "music", label: "Music" },
              { value: "denoise", label: "Denoise" },
            ]}
          />
        )}
        {tool === "deverb" && (
          <DeskSelectField
            isLight={isLight}
            label="De-reverb mode"
            value={deverbMode}
            onChange={setDeverbMode}
            options={[
              { value: "dialogue", label: "Dialogue" },
              { value: "vocal", label: "Vocal" },
            ]}
          />
        )}
        {tool === "finish" && (
          <DeskTextField isLight={isLight} label="Notes for the finish" value={notes} onChange={setNotes} placeholder="What the song still needs…" />
        )}
        {tool === "beat" && (
          <div className="space-y-3">
            <DeskSelectField
              isLight={isLight}
              label="Genre"
              value={beatGenre}
              onChange={setBeatGenre}
              options={["hip-hop", "trap", "drill", "r&b", "afrobeats", "pop", "edm", "lofi", "dancehall", "jersey-club"].map((g) => ({ value: g, label: g }))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <DeskTextField isLight={isLight} label="BPM" value={String(beatBpm)} onChange={(v) => setBeatBpm(Number(v.replace(/[^0-9]/g, "")) || 140)} />
              <DeskSelectField
                isLight={isLight}
                label="Musical key"
                value={beatKey}
                onChange={setBeatKey}
                options={["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B", "Cm", "Dm", "Em", "Fm", "Gm", "Am"].map((k) => ({ value: k, label: k }))}
              />
              <DeskTextField isLight={isLight} label="Length (seconds)" value={String(beatLength)} onChange={(v) => setBeatLength(Number(v.replace(/[^0-9]/g, "")) || 60)} />
              <DeskTextField isLight={isLight} label="Beat title" value={beatTitle} onChange={setBeatTitle} />
            </div>
          </div>
        )}
        {tool === "sfx" && (
          <DeskSelectField
            isLight={isLight}
            label="Category"
            value={sfxCategory}
            onChange={setSfxCategory}
            options={[
              { value: "impacts", label: "Impacts" },
              { value: "whooshes", label: "Whooshes" },
              { value: "risers", label: "Risers" },
              { value: "ui", label: "UI" },
              { value: "ambient", label: "Ambient" },
              { value: "foley", label: "Foley" },
            ]}
          />
        )}
        {isFileTool && (
          <p className={`text-xs ${muted}`}>
            The full workbench — mix &amp; master, stems, arrangement and the voice benches — is docked right below.
          </p>
        )}
      </AdvancedExpander>

      <CreateDeskRunner
        isLight={isLight}
        promptLabel={
          tool === "beat"
            ? "Describe the beat"
            : tool === "sfx"
              ? "Describe the sound effect"
              : "Name this bench job"
        }
        prompt={prompt}
        onPromptChange={setPrompt}
        costVisualBucs={toolCost(tool)}
        state={state}
        errorMessage={error}
        onRun={run}
        runLabel={
          tool === "cleanup"
            ? "Clean it up"
            : tool === "deverb"
              ? "De-reverb it"
              : tool === "finish"
                ? "Finish my song"
                : tool === "beat"
                  ? "Make the beat"
                  : "Make the sound"
        }
        result={
          resultUrl ? (
            <div>
              {tool === "cleanup" || tool === "deverb" ? (
                <div className="space-y-2">
                  <p className="text-sm font-bold">{resultTitle} — hear the difference</p>
                  <ABAudioPlayer
                    isLight={isLight}
                    beforeLabel={tool === "cleanup" ? "Original" : "Original"}
                    afterLabel={tool === "cleanup" ? "Cleaned" : "De-reverbed"}
                    beforeSource={file}
                    afterUrl={resultUrl}
                  />
                </div>
              ) : (
                <AudioResult url={resultUrl} title={resultTitle} />
              )}
              <QuestProgressChip isLight={isLight} lines={quest.lines} />
              <ResultChips
                isLight={isLight}
                onSendToEditor={props.onOpenEditor ? sendToEditor : undefined}
                editorBusy={editorBusy}
                onMakeAnother={() => {
                  setState("idle");
                  setResultUrl(null);
                }}
              />
            </div>
          ) : undefined
        }
      />
      {state === "running" && isFileTool && (
        <p className={`text-xs font-semibold ${muted}`}>
          Working on your audio — the job runs on the server, so it finishes even if you wander off.
        </p>
      )}
      <AudioFullBench isLight={isLight} file={file} sourceSongId={sourceSongId} sourceSong={pickedSong} />
    </div>
  );
}

/* ─── Ring 2 (2.6) — the FULL audio bench ───────────────────────────
   The Audio Studio hub's whole workbench, one bench at a time, on
   the hub's own endpoints (lib/world/audio-benches is the registry:
   endpoint, poll path, price source per bench). File benches work
   on the desk's picked song/upload above; the vocal benches work on
   the picked library song's hosted URL, exactly as their modals do;
   text benches take a script; hum runs its two-step; the
   arrangement bench rides the hub's draft rail (editing is free). */

function AudioFullBench(props: {
  isLight: boolean;
  file: File | null;
  sourceSongId: string | null;
  sourceSong: LibrarySong | null;
}) {
  const { isLight } = props;
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [benchId, setBenchId] = useState<AudioBenchId>("master");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AudioBenchResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* bench fields */
  const [genre, setGenre] = useState("trap");
  const [intensity, setIntensity] = useState("balanced");
  const [loudness, setLoudness] = useState("streaming");
  const [preset, setPreset] = useState("balanced");
  const [proStems, setProStems] = useState(false);
  const [stemFiles, setStemFiles] = useState<File[]>([]);
  const [vocalDb, setVocalDb] = useState(0);
  const [audioUrlInput, setAudioUrlInput] = useState("");
  const [strength, setStrength] = useState(0.7);
  const [keyShift, setKeyShift] = useState(0);
  const [tempoPercent, setTempoPercent] = useState(100);
  const [harmonyStyle, setHarmonyStyle] = useState("classic");
  const [mixLevel, setMixLevel] = useState(0.5);
  const [keyHint, setKeyHint] = useState("");
  const [tuneStyle, setTuneStyle] = useState("smooth");
  const [targetLufs, setTargetLufs] = useState(-14);
  const [lufsFormat, setLufsFormat] = useState("mp3");
  const [rateGenre, setRateGenre] = useState("");
  const [script, setScript] = useState("");
  const [podTitle, setPodTitle] = useState("");
  const [podMode, setPodMode] = useState("script");
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<Array<{ voice_id: string; name: string }>>([]);
  const [emotion, setEmotion] = useState("conversational");
  const [voFormat, setVoFormat] = useState("mp3");
  const [singVoices, setSingVoices] = useState<Array<{ id: string; name: string; style: string }>>([]);
  const [singVoiceId, setSingVoiceId] = useState("");
  const [singConfigured, setSingConfigured] = useState<boolean | null>(null);
  const [keepInstrumental, setKeepInstrumental] = useState(true);
  const [humRef, setHumRef] = useState<string | null>(null);
  const [humNote, setHumNote] = useState<string | null>(null);
  const [arrangement, setArrangement] = useState<Arrangement | null>(null);
  const [arrNote, setArrNote] = useState<string | null>(null);

  const def = audioBenchOf(benchId);
  const sourceUrl = audioUrlInput.trim() || props.sourceSong?.audioUrl || "";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stopPolling, []);

  /* Voice lists for the voiceover + singing benches (their pages'
     own rails: GET /api/voices, GET /api/singing-voice/voices). */
  useEffect(() => {
    if (benchId === "voiceover" && voices.length === 0) {
      void (async () => {
        try {
          const res = await fetch("/api/voices", { headers: await authHeaders() });
          const data = (await res.json().catch(() => ({}))) as { voices?: Array<{ voice_id: string; name: string }> };
          const list = Array.isArray(data.voices) ? data.voices : [];
          setVoices(list);
          if (list.length > 0 && !voiceId) setVoiceId(list[0]!.voice_id);
        } catch { /* the bench says so below */ }
      })();
    }
    if (benchId === "singing-voice" && singConfigured === null) {
      void (async () => {
        try {
          const [sRes, vRes] = await Promise.all([fetch("/api/singing-voice/status"), fetch("/api/singing-voice/voices")]);
          if (sRes.ok) {
            const sdata = (await sRes.json().catch(() => ({}))) as { configured?: boolean };
            setSingConfigured(sdata.configured === true);
          } else setSingConfigured(false);
          if (vRes.ok) {
            const vdata = (await vRes.json().catch(() => ({}))) as { voices?: Array<{ id: string; name: string; style: string }> };
            const list = Array.isArray(vdata.voices) ? vdata.voices : [];
            setSingVoices(list);
            if (list.length > 0 && !singVoiceId) setSingVoiceId(list[0]!.id);
          }
        } catch {
          setSingConfigured(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchId]);

  /* Arrangement draft load when the bench opens. */
  useEffect(() => {
    if (benchId !== "arrangement" || arrangement) return;
    void (async () => {
      const token = await getAccessToken();
      const loaded = await fetchServerArrangement(token);
      if (loaded) {
        setArrangement(loaded);
        setArrNote("Your saved arrangement — edit the roster here, it saves back to the same draft the Audio Studio opens.");
      } else {
        setArrNote("No arrangement draft yet — the full timeline editor on the Audio Studio starts one; this bench edits a saved draft.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchId]);

  const finishWith = (read: AudioBenchResult) => {
    if (read.failed) {
      setError(read.error ?? "The bench didn't finish.");
      setBusy(false);
      return;
    }
    setResult(read);
    refreshProfile();
    setBusy(false);
    void quest.checkAfter();
  };

  const startPoll = (jobId: string) => {
    if (!def.pollPath) return;
    const path = def.pollPath(jobId);
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(path, { headers: await authHeaders() });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const read = interpretAudioBenchResponse(benchId, data);
        if (read.done) {
          stopPolling();
          finishWith(read);
        }
      } catch {
        /* keep polling on transient errors, as the hub panels do */
      }
    }, 3000);
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    void quest.snapshot();
    try {
      /* ── arrangement: the draft rail, free ── */
      if (benchId === "arrangement") {
        if (!arrangement) throw new Error("No arrangement draft to save yet.");
        const token = await getAccessToken();
        await saveServerArrangement(token, arrangement);
        setArrNote("Saved — the Audio Studio opens this same draft.");
        setBusy(false);
        return;
      }
      /* ── hum: analyze (free) then generate, the page's two steps ── */
      if (benchId === "hum") {
        if (!props.file && !humRef) throw new Error("Pick a hum file above first (upload or a library song).");
        let ref = humRef;
        if (!ref) {
          const form = new FormData();
          form.append(HUM_FORM_FIELD, props.file!);
          for (const [k, v] of humAnalyzeFields()) form.append(k, v);
          const res = await fetch(def.endpoint, { method: "POST", headers: await authHeaders(), body: form });
          const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
          if (!res.ok) throw new Error(data.error ?? "Could not analyze that hum.");
          const parsed = humAnalysisOfResponse(data);
          if (!parsed) throw new Error("Analysis came back incomplete — try again.");
          ref = parsed.humRef;
          setHumRef(ref);
          setHumNote("Heard your hum — building the song around it…");
        }
        const form = new FormData();
        for (const [k, v] of humGenerateFields({ humRef: ref, mode: "simple" })) form.append(k, v);
        const res = await fetch(def.endpoint, { method: "POST", headers: await authHeaders(), body: form });
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        if (!res.ok) throw new Error(data.error ?? data.message ?? "Song generation failed.");
        const url = humSongUrlOfResponse(data);
        if (!url) throw new Error("The song came back without audio.");
        finishWith({ done: true, failed: false, urls: [{ label: "Your hum, as a song", url }], text: null, error: null });
        return;
      }
      /* ── text benches ── */
      if (def.input === "text") {
        if (!script.trim()) throw new Error("Write the script first — the bench works on your words.");
        const isPodcast = benchId === "podcast";
        const res = await fetch(def.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(
            isPodcast
              ? buildPodcastPayload({ mode: podMode, script, topic: script, title: podTitle || "My podcast", format: "mp3", musicBed: false })
              : buildVoiceoverPayload({ script, voiceId, emotion, format: voFormat, speed: 1 }),
          ),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string };
        if (!res.ok) throw new Error(data.message ?? data.error ?? "Generation failed.");
        const read = interpretAudioBenchResponse(benchId, data);
        if (!read.done) throw new Error("The make came back without audio.");
        finishWith(read);
        return;
      }
      /* ── URL benches (vocal polish / harmony / singing voice) ── */
      if (def.input === "url") {
        if (!sourceUrl) throw new Error("Pick a song from your library above (its hosted audio is the source), or paste an audio URL.");
        if (benchId === "singing-voice" && singConfigured === false) {
          throw new Error("Singing-voice conversion isn't connected yet — nothing was charged.");
        }
        const body =
          benchId === "vocal-polish"
            ? buildVocalPolishPayload({ audioUrl: sourceUrl, correctionStrength: strength, keyShift, tempoPercent })
            : benchId === "harmony"
              ? buildHarmonyPayload({ songId: props.sourceSong?.id, audioUrl: sourceUrl, keyHint, style: harmonyStyle, mixLevel })
              : buildSingingVoicePayload({ voiceId: singVoiceId, sourceAudioUrl: sourceUrl, strength, keepInstrumental });
        const res = await fetch(def.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string };
        if (!res.ok) throw new Error(data.message ?? data.error ?? "The bench didn't start.");
        if (benchId === "harmony") {
          const read = interpretAudioBenchResponse(benchId, data);
          if (!read.done) throw new Error("The harmony came back without audio.");
          finishWith(read);
          return;
        }
        const jobId = audioBenchJobIdOf(data);
        if (!jobId) throw new Error("The bench didn't start.");
        startPoll(jobId);
        return;
      }
      /* ── file benches ── */
      if (def.input === "stem-files") {
        if (stemFiles.length === 0) throw new Error("Add your stem files first — the mix bench mixes the files you give it.");
        const form = new FormData();
        for (const f of stemFiles) form.append(MIX_STEMS_FIELD, f);
        for (const [k, v] of mixFields({ genre, intensity, loudness, vocalLevelDb: vocalDb })) form.append(k, v);
        const res = await fetch(def.endpoint, { method: "POST", headers: await authHeaders(), body: form });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string };
        if (!res.ok) throw new Error(data.message ?? data.error ?? "The mix didn't start.");
        const jobId = audioBenchJobIdOf(data);
        if (!jobId) throw new Error("The mix didn't start.");
        startPoll(jobId);
        return;
      }
      if (!props.file) throw new Error("Pick a song from your library or upload a file above first — this bench works on your audio.");
      const form = new FormData();
      if (benchId === "rate-my-mix") {
        form.append(RATE_MY_MIX_FILE_FIELD, props.file);
        for (const [k, v] of rateMyMixFields({ genre: rateGenre })) form.append(k, v);
      } else {
        form.append(MASTER_FILE_FIELD, props.file);
        if (benchId === "master") for (const [k, v] of masterFields({ genre, intensity, loudness, sourceSongId: props.sourceSongId })) form.append(k, v);
        if (benchId === "quick-master") for (const [k, v] of quickMasterFields({ preset, sourceSongId: props.sourceSongId })) form.append(k, v);
        if (benchId === "stems") for (const [k, v] of stemsFields({ pro: proStems })) form.append(k, v);
        if (benchId === "vocal-tune") for (const [k, v] of vocalTuneFields({ style: tuneStyle, keyShift })) form.append(k, v);
        if (benchId === "lufs-normalize") for (const [k, v] of lufsNormalizeFields({ targetLufs, format: lufsFormat })) form.append(k, v);
      }
      const res = await fetch(def.endpoint, { method: "POST", headers: await authHeaders(), body: form });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "The bench didn't start.");
      if (!def.pollPath) {
        const read = interpretAudioBenchResponse(benchId, data);
        if (!read.done) throw new Error("The bench came back without a result.");
        finishWith(read);
        return;
      }
      const jobId = audioBenchJobIdOf(data);
      if (!jobId) throw new Error("The bench didn't start.");
      startPoll(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The bench hit a snag.");
      setBusy(false);
    }
  };

  const cost = def.cost(benchId === "voiceover" ? script : undefined);

  return (
    <div data-testid="world-audio-full-bench" className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        The full workbench — the Audio Studio&rsquo;s benches, in here
      </p>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Full audio benches">
        {AUDIO_BENCHES.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={benchId === b.id}
            data-testid={`world-audio-bench-${b.id}`}
            onClick={() => {
              setBenchId(b.id);
              setResult(null);
              setError(null);
            }}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              benchId === b.id
                ? "border-[#d4af37] bg-[#d4af37] text-black"
                : isLight
                  ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                  : "border-white/15 text-white/75 hover:text-white"
            }`}
          >
            {b.label} · {b.id === "voiceover" ? "per minute" : b.cost() === 0 ? "Free" : `${b.cost().toLocaleString("en-US")} VB`}
          </button>
        ))}
      </div>

      {def.input === "file" || def.input === "stem-files" ? (
        <p className={`text-xs ${muted}`}>
          {props.file ? `Working on: ${props.file.name}` : "Pick a song or upload a file at the top of this desk — file benches work on it."}
        </p>
      ) : null}
      {def.input === "stem-files" ? (
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`}>
          {stemFiles.length > 0 ? `${stemFiles.length} stem file(s) ready` : "Add the stem files"}
          <input type="file" accept="audio/*" multiple className="hidden" onChange={(e) => setStemFiles(Array.from(e.target.files ?? []))} />
        </label>
      ) : null}
      {def.input === "url" ? (
        <DeskTextField isLight={isLight} label="Audio URL (or pick a library song above)" value={audioUrlInput} onChange={setAudioUrlInput} placeholder={props.sourceSong ? props.sourceSong.title : "https://…"} />
      ) : null}
      {def.input === "text" ? (
        <div className="space-y-3">
          {benchId === "podcast" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DeskTextField isLight={isLight} label="Episode title" value={podTitle} onChange={setPodTitle} />
              <DeskSelectField isLight={isLight} label="Mode" value={podMode} onChange={setPodMode} options={[{ value: "script", label: "From my script" }, { value: "topic", label: "From a topic" }]} />
            </div>
          ) : null}
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{benchId === "podcast" ? "Script / topic" : "Voiceover script"}</span>
            <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={4} className={`w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-[#d4af37] ${isLight ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white"}`} />
          </label>
          {benchId === "voiceover" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DeskSelectField isLight={isLight} label="Voice" value={voiceId} onChange={setVoiceId} options={voices.length > 0 ? voices.map((v) => ({ value: v.voice_id, label: v.name })) : [{ value: "", label: "Voices loading…" }]} />
              <DeskSelectField isLight={isLight} label="Emotion" value={emotion} onChange={setEmotion} options={["energetic", "calm", "dramatic", "conversational"].map((e) => ({ value: e, label: e }))} />
              <DeskSelectField isLight={isLight} label="Format" value={voFormat} onChange={setVoFormat} options={[{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }]} />
            </div>
          ) : null}
        </div>
      ) : null}

      {(benchId === "master" || benchId === "mix") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskSelectField isLight={isLight} label="Genre" value={genre} onChange={setGenre} options={["trap", "hip-hop", "r&b", "pop", "afrobeats", "rock", "edm", "lofi"].map((g) => ({ value: g, label: g }))} />
          <DeskSelectField isLight={isLight} label="Intensity" value={intensity} onChange={setIntensity} options={["gentle", "balanced", "aggressive"].map((g) => ({ value: g, label: g }))} />
          <DeskSelectField isLight={isLight} label="Loudness" value={loudness} onChange={setLoudness} options={["streaming", "club", "radio", "dynamic"].map((g) => ({ value: g, label: g }))} />
          {benchId === "mix" ? <DeskTextField isLight={isLight} label="Vocal level (dB)" value={String(vocalDb)} onChange={(v) => setVocalDb(Number(v.replace(/[^0-9-]/g, "")) || 0)} /> : null}
        </div>
      )}
      {benchId === "quick-master" && (
        <DeskSelectField isLight={isLight} label="Preset" value={preset} onChange={setPreset} options={["balanced", "warm", "bright", "loud", "gentle"].map((g) => ({ value: g, label: g }))} />
      )}
      {benchId === "stems" && (
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={proStems} onChange={(e) => setProStems(e.target.checked)} />
          Pro stems (adds guitar + piano — same {audioBenchOf("stems").cost().toLocaleString("en-US")} Visual Bucs)
        </label>
      )}
      {benchId === "vocal-polish" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField isLight={isLight} label="Correction strength (0–1)" value={String(strength)} onChange={(v) => setStrength(Math.min(1, Math.max(0, Number(v) || 0)))} />
          <DeskTextField isLight={isLight} label="Key shift (semitones)" value={String(keyShift)} onChange={(v) => setKeyShift(Number(v.replace(/[^0-9-]/g, "")) || 0)} />
          <DeskTextField isLight={isLight} label="Tempo (%)" value={String(tempoPercent)} onChange={(v) => setTempoPercent(Number(v.replace(/[^0-9]/g, "")) || 100)} />
        </div>
      )}
      {benchId === "harmony" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField isLight={isLight} label="Style" value={harmonyStyle} onChange={setHarmonyStyle} />
          <DeskTextField isLight={isLight} label="Key hint (optional)" value={keyHint} onChange={setKeyHint} />
          <DeskTextField isLight={isLight} label="Harmony level (0–1)" value={String(mixLevel)} onChange={(v) => setMixLevel(Math.min(1, Math.max(0, Number(v) || 0)))} />
        </div>
      )}
      {benchId === "singing-voice" && (
        <div className="space-y-2">
          {singConfigured === false ? (
            <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>Singing-voice conversion isn&rsquo;t connected yet — the bench stays shut and nothing is charged.</p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskSelectField isLight={isLight} label="Singing voice" value={singVoiceId} onChange={setSingVoiceId} options={singVoices.length > 0 ? singVoices.map((v) => ({ value: v.id, label: `${v.name} — ${v.style}` })) : [{ value: "", label: "Voices loading…" }]} />
            <DeskTextField isLight={isLight} label="Strength (0–1)" value={String(strength)} onChange={(v) => setStrength(Math.min(1, Math.max(0, Number(v) || 0)))} />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold">
            <input type="checkbox" checked={keepInstrumental} onChange={(e) => setKeepInstrumental(e.target.checked)} />
            Keep the instrumental under the new voice
          </label>
        </div>
      )}
      {benchId === "vocal-tune" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskSelectField isLight={isLight} label="Style" value={tuneStyle} onChange={setTuneStyle} options={["smooth", "hard", "natural"].map((g) => ({ value: g, label: g }))} />
          <DeskTextField isLight={isLight} label="Key shift (semitones)" value={String(keyShift)} onChange={(v) => setKeyShift(Number(v.replace(/[^0-9-]/g, "")) || 0)} />
        </div>
      )}
      {benchId === "lufs-normalize" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <DeskSelectField isLight={isLight} label="Target" value={String(targetLufs)} onChange={(v) => setTargetLufs(Number(v))} options={[{ value: "-14", label: "Streaming · -14 LUFS" }, { value: "-11", label: "Loud · -11 LUFS" }, { value: "-16", label: "Podcast · -16 LUFS" }]} />
          <DeskSelectField isLight={isLight} label="Format" value={lufsFormat} onChange={setLufsFormat} options={[{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }]} />
        </div>
      )}
      {benchId === "rate-my-mix" && <DeskTextField isLight={isLight} label="Genre (optional)" value={rateGenre} onChange={setRateGenre} />}
      {benchId === "hum" && <p className={`text-xs ${muted}`}>{humNote ?? "Uses the file picked at the top of this desk: first it listens (free), then it builds the song."}</p>}
      {benchId === "arrangement" && arrangement ? (
        <div className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <DeskTextField isLight={isLight} label="Arrangement title" value={arrangement.title} onChange={(v) => setArrangement({ ...arrangement, title: v })} />
            <DeskTextField isLight={isLight} label="BPM" value={String(arrangement.bpm)} onChange={(v) => setArrangement({ ...arrangement, bpm: Number(v.replace(/[^0-9]/g, "")) || arrangement.bpm })} />
          </div>
          {arrangement.tracks.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span>{t.name}</span>
              <span className={muted}>{t.kind}</span>
              <label className="inline-flex cursor-pointer items-center gap-1">
                <input
                  type="checkbox"
                  checked={t.muted}
                  onChange={(e) =>
                    setArrangement({ ...arrangement, tracks: arrangement.tracks.map((x) => (x.id === t.id ? { ...x, muted: e.target.checked } : x)) })
                  }
                />
                Muted
              </label>
            </div>
          ))}
          {arrNote ? <p className={`text-xs ${muted}`}>{arrNote}</p> : null}
        </div>
      ) : benchId === "arrangement" ? (
        <p className={`text-xs ${muted}`}>{arrNote ?? "Loading your arrangement draft…"}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-xs font-semibold ${muted}`}>
          {cost === 0 ? "Free — shown before anything runs." : `Costs ${cost.toLocaleString("en-US")} Visual Bucs — shown before anything runs.`}
        </span>
        <button type="button" data-testid="world-audio-full-bench-run" onClick={() => void run()} disabled={busy} className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? "Working…" : benchId === "arrangement" ? "Save the arrangement draft" : `Run — ${def.label}`}
        </button>
      </div>
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      {busy && def.pollPath ? <p className={`text-xs font-semibold ${muted}`}>Working on the server — it finishes even if you wander off.</p> : null}
      {result ? (
        <div className="space-y-2" data-testid="world-audio-full-bench-result">
          {result.urls.map((u) => (
            <AudioResult key={u.url} url={u.url} title={u.label} />
          ))}
          {result.text ? (
            <pre className={`max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-xl border p-3 text-xs leading-relaxed ${isLight ? "border-[#C9A84C]/40 bg-white/50 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white/80"}`}>{result.text}</pre>
          ) : null}
          <QuestProgressChip isLight={isLight} lines={quest.lines} />
        </div>
      ) : null}
    </div>
  );
}
