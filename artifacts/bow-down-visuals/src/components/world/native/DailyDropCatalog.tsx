import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { NativeBoard, NativeBoardRow } from "./NativeBoard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import type { PanelPayload } from "@/lib/world/panel-payload";
import {
  DAILY_DROP_ARCHIVE_PATH,
  DAILY_DROP_CATALOG_PATH,
  DAILY_DROP_UNARCHIVE_PATH,
  applyDropArchive,
  dailyDropPanelPayload,
  dailyDropStationForKind,
  normalizeDailyDropCatalog,
  splitDailyDropCatalog,
  type DailyDropCatalog as DropCatalog,
  type DailyDropCatalogEntry,
  type DailyDropKind,
} from "@/lib/world/daily-drop-catalog";

/* ─── The Drop Catalogue (STACK-20 R2 item #18, Ring 4) ──────────────
   The Daily Drop card shows ONE template a day — the slate's whole
   30-template catalogue (DAILY_DROPS on the server, rotating by UTC
   day) was unreachable: miss a day and that template was gone until
   its turn came round again, and a template a member never wants
   kept its place in their list with no way to tidy it away.

   This section is the whole slate, docked in the Treasury under the
   day's drop card:
   • USE — opens the matching NATIVE desk in-world (stack-100 item
     97, closed in full): a thumbnail drop opens the Thumbnail
     Desk, a video drop opens the Visual Vibes Editor door where
     the video templates live, and hook + caption drops open the
     Hook Desk — Hook Studio's native desk in the Create Wing.
     Every kind has a native desk now; the def's href remains only
     as the fallback when no panel swap is wired.
   • ARCHIVE — per-member tidy-up (daily_drop_archives, migration
     0161): the row moves to the Archived list below and stays
     usable; unarchive brings it back. Archiving filters the
     member's own catalogue view only — the shared daily rotation
     is the same for everyone and does not change, and the copy
     says so.
   Honest states throughout: a failed load is a failed state with
   retry (never an empty-looking catalogue), and a row only moves
   lists after the server confirms the write. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

async function apiJson<T>(
  authHeaders: () => Promise<Record<string, string>>,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string; message?: string;
  };
  if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
  return data as T;
}

const KIND_LABEL: Record<DailyDropKind, string> = {
  thumbnail: "Thumbnail template",
  caption: "Caption pack",
  video: "Video template",
  hook: "Hook pack",
};

const useBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105";
const tidyBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

export function DailyDropCatalog({
  isLight,
  onOpenStation,
}: {
  isLight: boolean;
  /** Open another station's panel in-world (the page's panel swap)
   *  — a drop whose kind has a native desk "Uses" into it (item 97),
   *  carrying the drop's template payload so the desk opens
   *  prefilled (Stack-100 #2 item 97). */
  onOpenStation?: (stationId: string, payload?: PanelPayload | null) => void;
}) {
  const { t } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [catalog, setCatalog] = useState<DropCatalog | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    setState("loading");
    try {
      const d = await apiJson<unknown>(authHeaders, DAILY_DROP_CATALOG_PATH);
      const normalized = normalizeDailyDropCatalog(d);
      if (!normalized) throw new Error("bad catalogue shape");
      setCatalog(normalized);
      setState("ready");
    } catch {
      setState("failed");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleArchive(entry: DailyDropCatalogEntry) {
    if (busyKey) return;
    setBusyKey(entry.key);
    setNote(null);
    try {
      await apiJson(authHeaders, entry.archived ? DAILY_DROP_UNARCHIVE_PATH : DAILY_DROP_ARCHIVE_PATH, {
        method: "POST",
        body: { key: entry.key },
      });
      /* The server confirmed — only now does the row move lists. */
      setCatalog((prev) =>
        prev ? { ...prev, drops: applyDropArchive(prev.drops, entry.key, !entry.archived) } : prev,
      );
    } catch {
      setNote("That didn't save — your catalogue is unchanged.");
    } finally {
      setBusyKey(null);
    }
  }

  if (state === "loading") {
    return <NativeLoadingState isLight={isLight} message="Opening the drop catalogue…" />;
  }
  if (state === "failed") {
    return (
      <NativeErrorState
        isLight={isLight}
        title="The drop catalogue wouldn't open"
        message="Your templates are safe on the real rails — the Treasury just couldn't fetch the slate."
        onRetry={() => void load()}
      />
    );
  }
  /* Daily Drop turned off in the member's prefs: the catalogue
     closes with it, same as the day's drop card. */
  if (!catalog || !catalog.enabled) return null;

  const { active, archived } = splitDailyDropCatalog(catalog.drops);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  const row = (entry: DailyDropCatalogEntry) => (
    <NativeBoardRow
      key={entry.key}
      isLight={isLight}
      title={t(`retention.drops.${entry.key}.title`)}
      detail={`${KIND_LABEL[entry.kind]}${entry.isToday ? " · Today's drop" : ""}`}
      highlighted={entry.isToday}
      action={
        <span className="inline-flex items-center gap-1.5">
          {(() => {
            const stationId = dailyDropStationForKind(entry.kind);
            return stationId && onOpenStation ? (
              <button
                type="button"
                onClick={() => onOpenStation(stationId, dailyDropPanelPayload(entry))}
                data-testid={`world-daily-drop-use-${entry.key}`}
                className={useBtn}
              >
                Use <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <a
                href={entry.href}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`world-daily-drop-use-${entry.key}`}
                className={useBtn}
              >
                Use <ArrowRight className="h-3.5 w-3.5" />
              </a>
            );
          })()}
          <button
            type="button"
            disabled={busyKey === entry.key}
            onClick={() => void toggleArchive(entry)}
            data-testid={
              entry.archived
                ? `world-daily-drop-unarchive-${entry.key}`
                : `world-daily-drop-archive-${entry.key}`
            }
            className={tidyBtn(isLight)}
          >
            {entry.archived ? (
              <><ArchiveRestore className="h-3.5 w-3.5" /> Unarchive</>
            ) : (
              <><Archive className="h-3.5 w-3.5" /> Archive</>
            )}
          </button>
        </span>
      }
    />
  );

  return (
    <div className="space-y-4" data-testid="world-daily-drop-catalog">
      <NativeBoard
        isLight={isLight}
        title="Drop catalogue — every template"
        headline={
          <p className={`px-1 text-xs ${muted}`}>
            One template drops each day; the whole slate lives here. Use any of them whenever
            you like, and archive the ones you don&rsquo;t want in your list — archiving only
            tidies your own list, the shared daily rotation stays the same for everyone.
          </p>
        }
      >
        {active.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message={
              catalog.drops.length === 0
                ? "The catalogue is empty right now."
                : "Every template is archived — unarchive one below to bring it back."
            }
          />
        ) : (
          active.map(row)
        )}
      </NativeBoard>
      {note && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>
      )}
      {archived.length > 0 && (
        <NativeBoard isLight={isLight} title="Archived templates">
          {archived.map(row)}
        </NativeBoard>
      )}
    </div>
  );
}
