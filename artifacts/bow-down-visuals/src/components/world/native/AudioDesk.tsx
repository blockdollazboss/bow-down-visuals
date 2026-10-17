import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CreateDeskRunner, type CreateDeskJobState } from "./CreateDeskRunner";
import {
  AdvancedExpander,
  AudioResult,
  DeskSelectField,
  DeskTextField,
  ResultChips,
  useDeskAuthHeaders,
} from "./CreateDeskShared";
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
        return;
      }
      const isBeat = tool === "beat";
      const res = await fetch(isBeat ? "/api/beat/generate" : "/api/generate-sfx", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          isBeat ? buildBeatPayload(prompt, { genre: beatGenre }) : buildSfxPayload(prompt, { category: sfxCategory }),
        ),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !data.url) throw new Error(data.message || data.error || "Generation failed.");
      setResultUrl(data.url);
      setResultTitle(isBeat ? "Your beat" : "Your sound effect");
      refreshProfile();
      setState("done");
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
          <DeskSelectField
            isLight={isLight}
            label="Genre"
            value={beatGenre}
            onChange={setBeatGenre}
            options={["hip-hop", "trap", "drill", "r&b", "afrobeats", "pop", "edm", "lofi", "dancehall", "jersey-club"].map((g) => ({ value: g, label: g }))}
          />
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
            The bench&rsquo;s bench-mates — mix &amp; master, stems, arrangement and the voice benches — are a named
            follow-on; the full workbench waits one tap below on the website.
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
              <AudioResult url={resultUrl} title={resultTitle} />
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
    </div>
  );
}
