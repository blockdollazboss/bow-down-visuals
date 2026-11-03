import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Users, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  pickAutoSegment,
  presetsFromFanSegmentsResponse,
  type AutoSegmentCandidate,
} from "@/lib/audience-auto-segment";

/* ─── Audience auto-segment (org wave #2, rank 6b) ───
   Docked in Promote, visible in both tabs like the panels around it.
   The audience desk used to generate NO segment for the promote step
   (segments lived only inside the Email List desk's Fan Graph tab).
   This card attaches one automatically: it reads the fan-segments
   rail's live preset counts and names the biggest segment as the
   audience for this promote run, with the door into the desk where
   that segment sends. Honest states: loading, no fans yet (no
   segment invented), and a plain failure line with the desk door. */

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; segment: AutoSegmentCandidate | null }
  | { kind: "failed" };

export function AudienceAutoSegment() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/email-list/fan-segments", {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error(`fan-segments ${res.status}`);
        const data: unknown = await res.json();
        if (!alive) return;
        setState({ kind: "ready", segment: pickAutoSegment(presetsFromFanSegmentsResponse(data)) });
      } catch {
        if (alive) setState({ kind: "failed" });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) return null;

  return (
    <section
      aria-label="Audience segment"
      data-testid="audience-auto-segment"
      className={`rounded-2xl border p-5 ${
        isLight
          ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
          : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8c86a] text-black">
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={`text-sm font-black ${isLight ? "text-[#3d2f05]" : "text-white"}`}>
            Your audience, already segmented
          </h3>
          {state.kind === "loading" && (
            <p className={`mt-1 flex items-center gap-2 text-xs ${isLight ? "text-[#3d2f05]/60" : "text-white/50"}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading your fan graph…
            </p>
          )}
          {state.kind === "failed" && (
            <p className={`mt-1 text-xs ${isLight ? "text-[#3d2f05]/60" : "text-white/50"}`}>
              The segment rail didn't answer — your segments still live in the Fan Graph desk.
            </p>
          )}
          {state.kind === "ready" && state.segment && (
            <p className={`mt-1 text-xs leading-relaxed ${isLight ? "text-[#3d2f05]/70" : "text-white/60"}`}>
              Attached to this promote run:{" "}
              <strong className={isLight ? "text-[#3d2f05]" : "text-white"}>{state.segment.name}</strong>
              {" "}— {state.segment.count.toLocaleString("en-US")} fans, counted live from your fan graph.
              Every send from here aims at them first.
            </p>
          )}
          {state.kind === "ready" && !state.segment && (
            <p className={`mt-1 text-xs leading-relaxed ${isLight ? "text-[#3d2f05]/70" : "text-white/60"}`}>
              No fan segment yet — as fans follow, buy, and join, your first segment builds itself here.
            </p>
          )}
          <Link href="/email-list">
            <span className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold text-[#b8912a] hover:underline">
              Open the audience desk <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
