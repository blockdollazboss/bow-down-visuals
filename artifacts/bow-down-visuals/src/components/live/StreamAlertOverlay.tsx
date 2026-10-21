import { useEffect, useRef, useState } from "react";
import { BellRing, Sparkles } from "lucide-react";
import { AlertQueue, alertFromEventDetail, previewAlert, type StreamAlert } from "@/lib/live-alerts-client";
import { formatBucs } from "@/lib/visual-bucs";

/* ─── Stream alert overlay ────────────────────────────────────────────────
   Sits on the studio's Program monitor: when a tip lands or a new
   follower arrives mid-stream, a gold popup celebrates it — one at
   a time, a few seconds each, queued so bursts don't stack into
   mush. Events arrive from the chat room socket (the chat panel
   bridges them to a window event scoped by stream id). The Test
   alert button fires a clearly-tagged Preview that exists only in
   this browser — it is never broadcast or recorded as an event. */

export default function StreamAlertOverlay({ streamId }: { streamId: string }) {
  const [, setTick] = useState(0);
  const queueRef = useRef<AlertQueue | null>(null);
  if (!queueRef.current) {
    queueRef.current = new AlertQueue({}, () => setTick((t) => t + 1));
  }
  const queue = queueRef.current;

  useEffect(() => {
    const onAlert = (ev: Event) => {
      const alert = alertFromEventDetail((ev as CustomEvent).detail, streamId);
      if (alert) queue.push(alert);
    };
    window.addEventListener("bdv:live-alert", onAlert);
    return () => {
      window.removeEventListener("bdv:live-alert", onAlert);
      queue.clear();
    };
  }, [queue, streamId]);

  const current: StreamAlert | null = queue.current;

  return (
    <>
      {current && (
        <div
          className="pointer-events-none absolute left-1/2 top-14 z-20 w-[min(420px,86%)] -translate-x-1/2"
          data-testid="stream-alert-popup"
          role="status"
        >
          <div className="rounded-2xl border border-[#C9A84C]/70 bg-[#14100a]/95 px-5 py-4 text-center shadow-[0_0_40px_rgba(201,168,76,0.35)]">
            <p className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#e8c86a]">
              <Sparkles className="h-3.5 w-3.5" />
              {current.preview ? "Preview" : current.kind === "tip" ? "Tip" : "New follower"}
              {current.amountVb ? <span>· {formatBucs(current.amountVb)}</span> : null}
            </p>
            <p className="mt-1.5 text-lg font-black leading-tight text-white">{current.title}</p>
            {current.body && <p className="mt-1 line-clamp-2 text-sm text-white/70">{current.body}</p>}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => queue.push(previewAlert())}
        className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[11px] font-bold text-[#e8c86a] transition hover:bg-black/90"
        data-testid="stream-alert-test"
        title="Preview how alerts pop up on your Program feed — only you see this"
      >
        <BellRing className="h-3.5 w-3.5" /> Test alert
      </button>
    </>
  );
}
