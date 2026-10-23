import { useEffect, useState } from "react";
import { Flame, Play } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeBoard,
  NativeBoardRow,
  NativeCard,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native";
import {
  latestActivityLine,
  normalizeStudioProjects,
  normalizeStudioStrip,
  type StudioProjectRow,
  type StudioStrip,
} from "@/lib/world/studio-board";
import {
  characterMonogram,
  fetchVaultCharacters,
  type VaultCharacter,
} from "@/lib/world/characters";
import { CreatorProfileCreateCard } from "@/components/world/native/CreatorProfileCreate";

/* ─── StudioBoard — My Studio as a palace board (NATIVE-PLAN §3.1) ───
   The Create Wing's studio door, rebuilt in-world: your projects
   as board rows (GET /api/projects — the board's full list IS the
   old /my-projects fold-in), a balance + streak strip, and your
   vault characters as a portrait row. A row's one action is
   Continue: the host steps through into the Visual Vibes editor
   seeded with that project (the editorStepthroughSearch machinery
   in the panel host) — you step into the workbench, still inside
   the palace, and Return brings you back to this board. The strip
   and the portraits are secondary rails: each degrades quietly
   rather than taking the project list down with it. */

const PROJECT_CAP = 25;

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export interface StudioBoardProps {
  isLight: boolean;
  /** Step through into the editor seeded with this project. */
  onContinueProject: (projectId: string) => void;
}

export function StudioBoard({ isLight, onContinueProject }: StudioBoardProps) {
  const { profile, getAccessToken } = useAuth();
  const [projects, setProjects] = useState<StudioProjectRow[] | null>(null);
  const [projectsFailed, setProjectsFailed] = useState(false);
  const [strip, setStrip] = useState<StudioStrip | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [characters, setCharacters] = useState<VaultCharacter[] | null>(null);
  const [tick, setTick] = useState(0);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  /* The projects are the board's core: a failed read is the honest
     error state, never an empty-looking studio. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects", { headers: await authHeaders() });
        if (!res.ok) throw new Error("projects");
        if (!cancelled) {
          setProjects(normalizeStudioProjects(await res.json()));
          setProjectsFailed(false);
        }
      } catch {
        if (!cancelled) setProjectsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* The strip: streak (bonus/status) + latest activity
     (credits/history). Quietly absent when the rails don't answer. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [bonusRes, creditsRes] = await Promise.all([
          fetch("/api/bonus/status", { headers }),
          fetch("/api/credits/history", { headers }),
        ]);
        if (cancelled) return;
        if (bonusRes.ok) setStrip(normalizeStudioStrip(await bonusRes.json()));
        if (creditsRes.ok) setActivity(latestActivityLine(await creditsRes.json()));
      } catch {
        /* the strip is a rail, not the board — silence is honest */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* The vault portrait row (the picker's own shaping, reused). */
  useEffect(() => {
    let cancelled = false;
    fetchVaultCharacters(getAccessToken)
      .then((rows) => {
        if (!cancelled) setCharacters(rows);
      })
      .catch(() => {
        if (!cancelled) setCharacters([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const balance = profile?.credits ?? null;

  return (
    <div className="space-y-3">
      {/* Your creator profile (Stack-100 #48): shows yours when you
          have one; a member without one claims it right here, so a
          first publish never has to leave the World. */}
      <CreatorProfileCreateCard isLight={isLight} />

      {/* The balance + streak strip */}
      <NativeCard isLight={isLight}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            {balance === null ? "—" : balance.toLocaleString("en-US")}{" "}
            <span className="text-[#d4af37]">Visual Bucs</span>
          </span>
          {strip && (
            <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              <Flame className="h-3.5 w-3.5 text-[#d4af37]" />
              {strip.streak}-day streak
              {strip.bonusCredits > 0 ? (
                <span className={muted}>· {strip.bonusCredits.toLocaleString("en-US")} bonus VB banked</span>
              ) : null}
            </span>
          )}
          {activity && <span className={`text-xs ${muted}`}>{activity}</span>}
        </div>
      </NativeCard>

      {/* The vault characters, as a portrait row */}
      {characters !== null && characters.length > 0 && (
        <NativeCard isLight={isLight} title="Your vault characters">
          <div className="flex flex-wrap gap-2">
            {characters.map((c) => (
              <span
                key={c.id}
                data-testid="world-studio-vault-character"
                className={`inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 ${
                  isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                }`}
              >
                {c.portraitUrl ? (
                  <img src={c.portraitUrl} alt="" className="h-7 w-7 rounded-full border border-[#d4af37] object-cover" />
                ) : c.loopUrl ? (
                  <video src={c.loopUrl} muted playsInline className="h-7 w-7 rounded-full border border-[#d4af37] object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d4af37] bg-gradient-to-br from-amber-300 to-amber-600 text-[11px] font-black text-black">
                    {characterMonogram(c.name)}
                  </span>
                )}
                <span className={`max-w-[140px] truncate text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {c.name}
                </span>
              </span>
            ))}
          </div>
        </NativeCard>
      )}

      {/* The projects — the board itself */}
      {projectsFailed ? (
        <NativeErrorState
          isLight={isLight}
          title="The studio wouldn't open"
          message="Your projects are safe — the studio door just didn't answer. Try again."
          onRetry={() => setTick((n) => n + 1)}
        />
      ) : projects === null ? (
        <NativeLoadingState isLight={isLight} message="Opening your studio…" />
      ) : (
        <NativeBoard isLight={isLight} title="Your projects">
          {projects.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No projects yet — the studio is yours to fill."
              detail="Make something at the Create Wing's desks and it lands here, ready to continue."
            />
          ) : (
            <>
              {projects.slice(0, PROJECT_CAP).map((p) => (
                <NativeBoardRow
                  key={p.id}
                  isLight={isLight}
                  title={p.label}
                  detail={[p.projectType, fmtDate(p.createdAt)].filter(Boolean).join(" · ") || undefined}
                  meta={p.creditsUsed !== null && p.creditsUsed > 0 ? `${p.creditsUsed.toLocaleString("en-US")} VB` : undefined}
                  action={
                    <button
                      type="button"
                      data-testid="world-studio-continue"
                      onClick={() => onContinueProject(p.id)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                    >
                      <Play className="h-3.5 w-3.5" /> Continue
                    </button>
                  }
                />
              ))}
              {projects.length > PROJECT_CAP && (
                <p className={`px-1 pt-1 text-[11px] ${muted}`}>
                  Showing your latest {PROJECT_CAP} of {projects.length} projects — the full archive waits on the website, one tap below.
                </p>
              )}
            </>
          )}
        </NativeBoard>
      )}
    </div>
  );
}
