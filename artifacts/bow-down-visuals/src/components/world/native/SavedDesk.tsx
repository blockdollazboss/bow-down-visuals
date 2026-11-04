/**
 * SavedDesk — the My Studio board's native Saved desk
 * (stack1500 world parity wave #3, census item 30).
 *
 * Your bookmark shelf without leaving the World: everything you
 * saved — posts, tracks, videos, profiles — newest first, with
 * kind tabs like the website's shelf, and an Unsave on every
 * row.
 *
 * Honest rows: when the thing itself has gone or become
 * invisible since the save (the rail embeds null on purpose —
 * a close-friends post leaves your shelf when you leave the
 * circle), the row says so plainly instead of vanishing or
 * dressing up a ghost, and Unsave still works so the shelf can
 * always be cleaned. Free throughout — the rails charge nothing.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SAVES_PATH,
  SAVE_KINDS,
  saveCounts,
  saveDeletePath,
  savesForTab,
  savesOfResponse,
  withoutSave,
  type SaveKind,
  type SavedItem,
  type SavedTab,
} from "@/lib/world/saved-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

/** Catalog keys for the seam's kind labels — the seam keeps the
 *  English labels as defaults; the desk renders its own language. */
const KIND_LABEL_KEYS: Record<SaveKind, string> = {
  post: "worldCatalogLibrary.savedKindPost",
  track: "worldCatalogLibrary.savedKindTrack",
  video: "worldCatalogLibrary.savedKindVideo",
  profile: "worldCatalogLibrary.savedKindProfile",
};
const KIND_SINGULAR_KEYS: Record<SaveKind, string> = {
  post: "worldCatalogLibrary.savedKindPostOne",
  track: "worldCatalogLibrary.savedKindTrackOne",
  video: "worldCatalogLibrary.savedKindVideoOne",
  profile: "worldCatalogLibrary.savedKindProfileOne",
};

export function SavedDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const deskHeaders = useDeskAuthHeaders();
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<SavedTab>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const headers = await deskHeaders();
      const res = await fetch(SAVES_PATH, { headers });
      if (!res.ok) throw new Error("load failed");
      const parsed = savesOfResponse(await res.json().catch(() => ({})));
      if (!parsed) throw new Error("load failed");
      setItems(parsed);
    } catch {
      setFailed(true);
    }
  }, [deskHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function unsave(item: SavedItem) {
    const key = `${item.kind}:${item.targetId}`;
    if (busyKey) return;
    setBusyKey(key);
    setNote(null);
    /* Optimistic removal, restored whole if the rail refuses. */
    setItems((prev) => (prev ? withoutSave(prev, item.kind, item.targetId) : prev));
    try {
      const headers = await deskHeaders();
      const res = await fetch(saveDeletePath(item.kind, item.targetId), {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error("unsave failed");
    } catch {
      setNote(t("worldCatalogLibrary.savedUnsaveError"));
      void load();
    } finally {
      setBusyKey(null);
    }
  }

  const counts = items ? saveCounts(items) : null;
  const visible = items ? savesForTab(items, tab) : [];

  return (
    <div className="space-y-3" data-testid="world-saved-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>{t("worldCatalogLibrary.savedTitle")}</p>
        <p className={`text-xs ${muted}`}>
          {t("worldCatalogLibrary.savedIntro")}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldCatalogLibrary.savedAriaKinds")}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "all"}
          data-testid="world-saved-desk-tab-all"
          className={chipCls(tab === "all")}
          onClick={() => setTab("all")}
        >
          {t("worldCatalogLibrary.savedTabAll")}{items ? ` (${items.length})` : ""}
        </button>
        {SAVE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={tab === kind}
            data-testid={`world-saved-desk-tab-${kind}`}
            className={chipCls(tab === kind)}
            onClick={() => setTab(kind)}
          >
            {t(KIND_LABEL_KEYS[kind])}
            {counts ? ` (${counts[kind]})` : ""}
          </button>
        ))}
      </div>

      {failed ? (
        <div data-testid="world-saved-desk-failed">
          <p className={errCls}>{t("worldCatalogLibrary.savedLoadError")}</p>
          <button type="button" className={`mt-2 ${chipCls(false)}`} onClick={() => void load()}>
            {t("worldCatalogLibrary.sharedTryAgain")}
          </button>
        </div>
      ) : items === null ? (
        <p className={`text-sm ${muted}`}>{t("worldCatalogLibrary.savedLoading")}</p>
      ) : visible.length === 0 ? (
        <p className={`text-sm ${muted}`} data-testid="world-saved-desk-empty">
          {items.length === 0
            ? t("worldCatalogLibrary.savedEmptyAll")
            : t("worldCatalogLibrary.savedEmptyTab", {
                tab: tab === "all" ? t("worldCatalogLibrary.savedThisTab") : t(KIND_LABEL_KEYS[tab]),
              })}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((item) => {
            const key = `${item.kind}:${item.targetId}`;
            return (
              <li
                key={key}
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${cardCls}`}
                data-testid={`world-saved-desk-item-${key}`}
              >
                <span className={chipCls(false)}>{t(KIND_LABEL_KEYS[item.kind])}</span>
                <div className="min-w-0">
                  {item.gone ? (
                    <p className={`text-sm ${muted}`}>
                      {t("worldCatalogLibrary.savedGoneLine", { kind: t(KIND_SINGULAR_KEYS[item.kind]) })}
                    </p>
                  ) : (
                    <>
                      <p className={`truncate text-sm font-bold ${strong}`}>{item.label}</p>
                      {item.sublabel ? <p className={`text-xs ${muted}`}>{item.sublabel}</p> : null}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  data-testid={`world-saved-desk-unsave-${key}`}
                  className={`ml-auto ${chipCls(false)}`}
                  disabled={busyKey !== null}
                  onClick={() => void unsave(item)}
                >
                  {busyKey === key ? t("worldCatalogLibrary.savedUnsaving") : t("worldCatalogLibrary.savedUnsave")}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {note ? <p className={errCls}>{note}</p> : null}
    </div>
  );
}
