import { useCallback, useEffect, useState } from "react";
import { Ban, Check, Copy, EyeOff, KeyRound, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson } from "@/lib/social-api";

/* ── RTMP ingest key (migration 0194) ───────────────────────────────────
   The mirror of DestinationKeysPanel: destinations are keys OUT, this
   is the creator's personal key IN — an external encoder (OBS,
   VirtualDJ, Serato, djay…) pushes RTMP to it and becomes the Go Live
   source. The owner has to paste the key into their program, so the
   create/regenerate responses return it — behind the owner's session
   only, and only ONCE: the server stores just a one-way hash, so an
   existing key can never be shown again (the panel says so plainly
   and points at regenerate). The status payload the panel loads on
   mount never carries it. */

export interface IngestKeyDto {
  enabled: boolean;
  ingest_url: string | null;
  has_key: boolean;
  key_hint: string | null;
  stream_title: string | null;
  revoked: boolean;
}

interface IngestStatusResponse {
  ingest: IngestKeyDto;
}

interface IngestKeyResponse extends IngestStatusResponse {
  /* The plain key — present ONLY in the response that mints it
     (create / regenerate). Null when the key already existed:
     hash-only storage means it can't be shown a second time. */
  stream_key: string | null;
  code?: string;
}

export default function IngestKeyPanel() {
  const { getAccessToken } = useAuth();
  const [ingest, setIngest] = useState<IngestKeyDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  /* Set when the owner asks to see an existing key: it exists, but
     hash-only storage means it can never be displayed again. */
  const [keyNotReshown, setKeyNotReshown] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<IngestStatusResponse>(getAccessToken, "/api/live-streams/ingest-key");
      setIngest(res.ingest);
      setTitle(res.ingest.stream_title ?? "");
      setLoadError(null);
    } catch {
      setLoadError("Your stream key status couldn't load. Try again in a moment.");
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (action: string, fn: () => Promise<void>) => {
      setBusy(action);
      setNote(null);
      try {
        await fn();
      } catch (err) {
        setNote(err instanceof Error ? err.message : "Something went wrong. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const reveal = () =>
    run("reveal", async () => {
      const res = await apiJson<IngestKeyResponse>(getAccessToken, "/api/live-streams/ingest-key/reveal", {
        method: "POST",
      });
      setIngest(res.ingest);
      if (res.stream_key) {
        // This response minted the key — the one and only display.
        setRevealedKey(res.stream_key);
        setKeyNotReshown(false);
      } else {
        setKeyNotReshown(true);
      }
    });

  const regenerate = () =>
    run("regenerate", async () => {
      const res = await apiJson<IngestKeyResponse>(getAccessToken, "/api/live-streams/ingest-key/regenerate", {
        method: "POST",
      });
      setIngest(res.ingest);
      setRevealedKey(res.stream_key);
      setKeyNotReshown(false);
      setConfirmingRegen(false);
      setNote("New key created — copy it now, because it can't be shown again. The old key stopped working the moment this one was made, so update your program before you go live.");
    });

  const revoke = () =>
    run("revoke", async () => {
      const res = await apiJson<IngestStatusResponse>(getAccessToken, "/api/live-streams/ingest-key/revoke", {
        method: "POST",
      });
      setIngest(res.ingest);
      setRevealedKey(null);
      setKeyNotReshown(false);
      setConfirmingRegen(false);
      setNote("Key revoked. Nothing can stream with it now — create a fresh key whenever you're ready.");
    });

  const saveTitle = () =>
    run("title", async () => {
      const res = await apiJson<IngestStatusResponse>(getAccessToken, "/api/live-streams/ingest-key", {
        method: "PATCH",
        body: JSON.stringify({ stream_title: title.trim() ? title.trim() : null }),
      });
      setIngest(res.ingest);
      setNote("Saved. Streams your program starts will use this title.");
    });

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
    } catch {
      setNote("Copy didn't work here — select the text and copy it manually.");
    }
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-10" data-testid="ingest-key-panel">
      <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 text-white">
        <h2 className="flex items-center gap-2 text-lg font-black">
          <KeyRound className="h-5 w-5 text-[#e8c86a]" /> Stream from your own software
        </h2>
        <p className="mt-1 text-sm text-white/50">
          Prefer OBS, VirtualDJ, Serato or djay? Point your program at the server below with your personal
          stream key and it becomes your Go Live source — same stage, same chat, same replay. Your key is
          yours alone: anyone holding it can stream as you, so treat it like a password.
        </p>
        <p className="mt-2 text-sm text-white/50">
          One honest limit: your program's feed goes out exactly as it arrives. This stage passes it through —
          it doesn't re-encode or build a quality ladder — so the picture your viewers get is the one rendition
          you send. Set your encoder's bitrate with your viewers' connections in mind, and only one program
          can stream on your key at a time.
        </p>

        {loadError && <p className="mt-3 text-sm text-red-300">{loadError}</p>}
        {note && <p className="mt-3 text-sm text-[#e8c86a]">{note}</p>}

        {ingest && !ingest.enabled && (
          <p className="mt-4 rounded-xl border border-white/10 px-3 py-2 text-sm text-white/60">
            Encoder streaming isn't switched on for this stage right now — the browser studio above still works as always.
          </p>
        )}

        {ingest && ingest.enabled && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-white/40">Server URL</label>
              {ingest.ingest_url ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm">{ingest.ingest_url}</code>
                  <button
                    type="button"
                    onClick={() => void copy("url", ingest.ingest_url!)}
                    className="inline-flex items-center gap-1 rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold transition hover:border-[#e8c86a]/60"
                  >
                    {copied === "url" ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />} Copy
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-sm text-white/50">
                  The server address isn't published yet — check back here before showtime.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-white/40">Your stream key</label>
              {revealedKey ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-xl border border-[#e8c86a]/40 bg-black/40 px-3 py-2 text-sm">{revealedKey}</code>
                    <button
                      type="button"
                      onClick={() => void copy("key", revealedKey)}
                      className="inline-flex items-center gap-1 rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold transition hover:border-[#e8c86a]/60"
                    >
                      {copied === "key" ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />} Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevealedKey(null)}
                      className="inline-flex items-center gap-1 rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold transition hover:border-white/40"
                    >
                      <EyeOff className="h-4 w-4" /> Hide
                    </button>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-[#e8c86a]">
                    Copy it now — for your protection this key is shown only once and can't be displayed again. If you lose it, generate a new one below.
                  </p>
                </>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white/50">
                    {ingest.has_key
                      ? `Key ending in •••${ingest.key_hint ?? ""} — shown only when it's created`
                      : ingest.revoked
                        ? "Your last key was revoked — create a fresh one"
                        : "No key yet — create yours"}
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void reveal()}
                    className="rounded-xl bg-[#e8c86a] px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40"
                  >
                    {busy === "reveal" ? "Working…" : ingest.has_key ? "Show my key" : "Create my key"}
                  </button>
                </div>
              )}
              {keyNotReshown && !revealedKey && (
                <p className="mt-1 text-xs text-white/50">
                  That key can't be shown again — it's stored only as a scrambled fingerprint, never as readable text. If you no longer have it, use Regenerate key below to make a new one; the old one stops working the moment the new one is created.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {confirmingRegen ? (
                <>
                  <span className="text-sm text-red-200">
                    The old key dies immediately — including a program live right now. Sure?
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void regenerate()}
                    className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
                  >
                    {busy === "regenerate" ? "Working…" : "Yes, new key"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRegen(false)}
                    className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold transition hover:border-white/40"
                  >
                    Keep my key
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null || !ingest.has_key}
                  onClick={() => setConfirmingRegen(true)}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold transition hover:border-[#e8c86a]/60 disabled:opacity-40"
                >
                  <RefreshCw className="h-4 w-4" /> Regenerate key
                </button>
              )}
              <button
                type="button"
                disabled={busy !== null || !ingest.has_key}
                onClick={() => void revoke()}
                className="inline-flex items-center gap-1 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-400/60 disabled:opacity-40"
              >
                <Ban className="h-4 w-4" /> Revoke key
              </button>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-white/40">
                Title for program-started streams
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Friday Night Set — your program can't type one, so it uses this"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#e8c86a]/60 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={busy !== null || !ingest.has_key}
                  onClick={() => void saveTitle()}
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold transition hover:border-[#e8c86a]/60 disabled:opacity-40"
                >
                  {busy === "title" ? "Saving…" : "Save title"}
                </button>
              </div>
              <p className="mt-1 text-xs text-white/40">
                Leave it empty and a program-started stream is titled “your name live”, like the studio's default.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
