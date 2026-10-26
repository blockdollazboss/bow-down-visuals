import { useEffect, useRef, useState } from "react";
import { Captions, CaptionsOff, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";
import {
  LiveCaptionsViewerClient,
  captionBarState,
  captionsSocketUrl,
  loadCaptionPref,
  saveCaptionPref,
  type CaptionSocketLike,
} from "@/lib/live-captions-client";

/* ─── Live captions bar — the VIEWER side of #160 ───────────────────────
   Docked inside the watch-page player, never a page of its own. The
   viewer owns both controls: captions on/off and THEIR language —
   the streamer speaks once, every viewer reads in the language they
   picked, translated live on the translator rail. The client only
   connects when this viewer turns captions on (no socket, no poll,
   no translation spend for a viewer who never asked). States are
   honest: track off says the streamer hasn't opened captions; the
   ticket door says a ticket opens captions too; waiting says
   waiting — the bar never invents a line. */

export default function LiveCaptionsBar({ streamId }: { streamId: string }) {
  const { getAccessToken } = useAuth();
  const [pref, setPref] = useState(() => loadCaptionPref(typeof localStorage !== "undefined" ? localStorage : null));
  const [, setTick] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const clientRef = useRef<LiveCaptionsViewerClient | null>(null);

  /* One client per (stream, on) — built when the viewer turns
     captions on, torn down when they turn them off. Language changes
     ride the same client (it rejoins in the new language). */
  useEffect(() => {
    if (!pref.on) {
      clientRef.current?.stop();
      clientRef.current = null;
      return;
    }
    const client = new LiveCaptionsViewerClient(
      streamId,
      pref.language,
      {
        fetchJson: async (path, init) => {
          const res = await apiFetch(getAccessToken, path, init);
          return { status: res.status, json: await res.json().catch(() => null) };
        },
        getAccessToken,
        socketUrl: (id, lang, token) => captionsSocketUrl(window.location, id, lang, token),
        openSocket: (url) => new WebSocket(url) as unknown as CaptionSocketLike,
      },
      () => setTick((t) => t + 1),
    );
    clientRef.current = client;
    void client.start();
    return () => {
      client.stop();
      if (clientRef.current === client) clientRef.current = null;
    };
    // getAccessToken identity is stable enough for this lifecycle;
    // the stream + the on switch are the real keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, pref.on]);

  const client = clientRef.current;
  const line = pref.on && client ? client.currentLine : null;
  const prevLine = pref.on && client && client.lines.length > 1 ? client.lines[client.lines.length - 2] : null;
  const state = captionBarState({
    viewerOn: pref.on,
    trackEnabled: client?.trackEnabled ?? null,
    ticketLocked: client?.ticketLocked ?? false,
    hasLine: !!line,
  });

  function updatePref(next: Partial<typeof pref>) {
    const merged = { ...pref, ...next };
    setPref(merged);
    saveCaptionPref(typeof localStorage !== "undefined" ? localStorage : null, merged);
    if (next.language && clientRef.current) {
      void clientRef.current.setLanguage(next.language);
    }
  }

  const languages = client?.languages.length
    ? client.languages
    : [{ code: pref.language, label: pref.language === "en" ? "English (original)" : pref.language }];

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-3" data-testid="live-captions-bar">
      {(state === "showing" || state === "waiting" || state === "track-off" || state === "ticket-locked") && (
        <div className="flex w-full max-w-2xl flex-col items-center gap-1 text-center">
          {state === "showing" && (
            <>
              {prevLine && <p className="rounded-lg bg-black/55 px-3 py-1 text-sm font-semibold text-white/60">{prevLine.text}</p>}
              <p className="rounded-lg bg-black/75 px-4 py-1.5 text-base font-bold leading-snug text-white md:text-lg" data-testid="caption-line">
                {line!.text}
              </p>
            </>
          )}
          {state === "waiting" && (
            <p className="rounded-lg bg-black/60 px-3 py-1 text-xs font-semibold text-white/70">
              Captions on — lines appear here as the streamer speaks.
            </p>
          )}
          {state === "track-off" && (
            <p className="rounded-lg bg-black/60 px-3 py-1 text-xs font-semibold text-white/70">
              The streamer hasn't turned captions on for this stream.
            </p>
          )}
          {state === "ticket-locked" && (
            <p className="rounded-lg bg-black/60 px-3 py-1 text-xs font-semibold text-white/70">
              This show is ticketed — your ticket opens the captions too.
            </p>
          )}
        </div>
      )}
      <div className="pointer-events-auto relative flex items-center gap-2 self-end">
        {pref.on && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-black/90"
              data-testid="btn-caption-language"
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
            >
              {languages.find((l) => l.code === pref.language)?.label ?? pref.language}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {pickerOpen && (
              <ul
                role="listbox"
                className="absolute bottom-full right-0 mb-2 max-h-56 w-52 overflow-auto rounded-xl border border-white/15 bg-[#14100a] p-1 shadow-2xl"
                data-testid="caption-language-list"
              >
                {languages.map((l) => (
                  <li key={l.code}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={l.code === pref.language}
                      onClick={() => {
                        updatePref({ language: l.code });
                        setPickerOpen(false);
                      }}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold transition hover:bg-white/10 ${
                        l.code === pref.language ? "text-amber-300" : "text-white/80"
                      }`}
                    >
                      {l.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => updatePref({ on: !pref.on })}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black transition ${
            pref.on ? "bg-amber-400 text-black" : "bg-black/70 text-white hover:bg-black/90"
          }`}
          data-testid="btn-toggle-captions"
          aria-pressed={pref.on}
          title={pref.on ? "Turn captions off" : "Turn captions on — read this stream in your language"}
        >
          {pref.on ? <Captions className="h-4 w-4" /> : <CaptionsOff className="h-4 w-4" />}
          CC
        </button>
      </div>
    </div>
  );
}
