import { useCallback, useEffect, useState } from "react";
import { KeyRound, Radio, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { reachApi, type SavedDestination } from "@/lib/reach-api";
import { apiJson } from "@/lib/social-api";
import {
  liveStreamDestinations,
  savedDestinationsFromPayload,
  savedDestinationsOrEmpty,
  type LiveStreamDestination,
} from "@/lib/destination-keys";

/* ── Multistream destinations (Stack 9 #1) ──────────────────────────────
   Stream keys are WRITE-ONLY here: the form accepts a key, the list
   shows only that one is saved. The key is never read back — the API
   never returns it, so neither can this panel. Fan-out verdicts come
   from the stream's own destinations state, shown exactly as the
   server recorded them (live / error with its reason / pending). */

const PLATFORM_SUGGESTIONS = ["youtube", "twitch", "facebook", "tiktok", "kick", "x"];

interface StreamDtoLite {
  id: string;
  destinations?: LiveStreamDestination[];
}

export default function DestinationKeysPanel() {
  const { getAccessToken } = useAuth();
  const [saved, setSaved] = useState<SavedDestination[]>([]);
  const [liveStream, setLiveStream] = useState<StreamDtoLite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [platform, setPlatform] = useState("youtube");
  const [ingestUrl, setIngestUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, status] = await Promise.all([
        reachApi.listDestinations(getAccessToken),
        apiJson<{ live_stream: StreamDtoLite | null }>(getAccessToken, "/api/live-streams/status").catch(() => ({ live_stream: null })),
      ]);
      const parsedDestinations = savedDestinationsFromPayload(d);
      setLiveStream(
        (status as { live_stream?: StreamDtoLite | null } | null)?.live_stream ?? null,
      );
      if (!parsedDestinations) {
        setSaved([]);
        setLoadError("Your destinations couldn't load. Try again in a moment.");
        return;
      }
      setSaved(parsedDestinations);
      setLoadError(null);
    } catch {
      setLoadError("Your destinations couldn't load. Try again in a moment.");
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const savedDestinations = savedDestinationsOrEmpty(saved);
  const destinations = liveStreamDestinations(liveStream?.destinations).filter(
    (d) => d.platform !== "site",
  );

  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-10" data-testid="destination-keys-panel">
      <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 text-white">
        <h2 className="flex items-center gap-2 text-lg font-black">
          <Radio className="h-5 w-5 text-[#e8c86a]" /> Multistream destinations
        </h2>
        <p className="mt-1 text-sm text-white/50">
          Save a destination's RTMP ingest URL + stream key and your broadcast relays there while you're live on your profile.
          Keys are stored on the server only — they're never shown again after you save, not even to you.
        </p>
        {loadError && <p className="mt-3 text-sm text-red-300">{loadError}</p>}

        {savedDestinations.length > 0 && (
          <ul className="mt-4 space-y-2">
            {savedDestinations.map((d) => {
              const live = destinations.find((x) => x.platform === d.platform);
              return (
                <li key={d.platform} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <b className="capitalize">{d.platform}</b>
                    <span className="block truncate text-xs text-white/40">{d.ingestUrl}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    {liveStream ? (
                      live ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${live.status === "live" ? "bg-red-600 text-white" : live.status === "error" ? "bg-red-950 text-red-300" : "bg-white/10 text-white/60"}`}>
                          {live.status}
                        </span>
                      ) : (
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">not in this stream's destinations</span>
                      )
                    ) : (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">key saved</span>
                    )}
                    <button
                      type="button"
                      title="Remove this destination's key"
                      onClick={async () => {
                        await reachApi.deleteDestination(getAccessToken, d.platform).catch(() => undefined);
                        void load();
                      }}
                      className="text-white/40 transition hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                  {live?.status === "error" && live.error_reason && <p className="w-full text-xs text-red-300">{live.error_reason}</p>}
                </li>
              );
            })}
          </ul>
        )}

        {liveStream && destinations.some((d) => d.status === "error") && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const v = await reachApi.runFanOut(getAccessToken, liveStream.id);
                setNote(v.verdicts.map((x) => `${x.platform}: ${x.status}${x.reason ? ` — ${x.reason}` : ""}`).join(" · ") || "No destinations to relay to.");
              } catch (e) {
                setNote(e instanceof Error ? e.message : "Fan-out couldn't run.");
              } finally {
                setBusy(false);
                void load();
              }
            }}
            className="mt-3 rounded-full bg-[#e8c86a] px-4 py-2 text-sm font-bold text-black transition hover:scale-[1.02] disabled:opacity-50"
          >
            Retry fan-out
          </button>
        )}

        <form
          className="mt-5 grid gap-3 md:grid-cols-[160px_1fr_1fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setNote(null);
            try {
              await reachApi.saveDestination(getAccessToken, platform.trim().toLowerCase(), ingestUrl.trim(), streamKey.trim());
              setStreamKey("");
              setIngestUrl("");
              setNote(`Saved. ${platform} will pick up your next broadcast (add it to the stream's destinations when you go live).`);
              void load();
            } catch (err) {
              setNote(err instanceof Error ? err.message : "That destination couldn't be saved.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            list="bdv-destination-platforms"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            placeholder="Platform"
            className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none"
          />
          <datalist id="bdv-destination-platforms">
            {PLATFORM_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <input
            value={ingestUrl}
            onChange={(e) => setIngestUrl(e.target.value)}
            placeholder="RTMP ingest URL (rtmp://…)"
            className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none"
          />
          <input
            type="password"
            autoComplete="off"
            value={streamKey}
            onChange={(e) => setStreamKey(e.target.value)}
            placeholder="Stream key (never shown again)"
            className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none"
          />
          <button type="submit" disabled={busy || !platform.trim() || !ingestUrl.trim() || !streamKey.trim()} className="inline-flex items-center gap-2 rounded-full bg-[#e8c86a] px-4 py-2 text-sm font-bold text-black transition enabled:hover:scale-[1.02] disabled:opacity-50">
            <KeyRound className="h-4 w-4" /> Save key
          </button>
        </form>
        {note && <p className="mt-3 text-sm text-white/60">{note}</p>}
        <p className="mt-3 text-xs text-white/40">
          Honest limits: fan-out relays the feed exactly as recorded (no re-encoding). A browser recording in WebM can't be relayed to RTMP —
          the destination will show the reason instead of pretending to be live. Streams on the hosted transport can't be relayed from here at all.
        </p>
      </div>
    </section>
  );
}
