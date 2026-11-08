/**
 * LocationsBench — the Video Desk's native Locations bench
 * (stack200 world parity lane B1, census item 3), stacked
 * inside the Video Desk beside the template and storyboard
 * benches.
 *
 * The saved-places surface from pages/locations.tsx, in the
 * room: the same free rails (GET/POST/DELETE /api/locations,
 * POST /api/locations/upload) the page and the editor's
 * Locations tab share — places saved here are the places the
 * editor offers, because both read the one list. Gallery with
 * thumbnails, add-by-URL, upload, delete — the page's whole
 * manager, including its cover-art cross-link: each card's
 * "Use in cover art" button (the page links to
 * /cover-art?scene=<image_url>) opens the Cover Art desk
 * in-World through the panel-payload channel (stack300
 * item 96) — fullscreen never drops.
 *
 * Honesty rules ride the seam: a failed load shows the error
 * state with a retry — never the page's "No locations yet"
 * line, which appears only after a successful empty load.
 * All copy is the page's own locations.* catalog copy.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Disc3, Link2, Loader2, MapPin, Plus, Trash2, Upload } from "lucide-react";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  LOCATIONS_PATH,
  LOCATIONS_UPLOAD_PATH,
  buildLocationBody,
  coverArtSceneUrl,
  locationPath,
  locationUploadProblem,
  locationsOf,
  type SavedLocation,
} from "@/lib/world/locations-desk";
import { coverArtScenePayload, type PanelPayload } from "@/lib/world/panel-payload";

export interface LocationsBenchProps {
  isLight: boolean;
  /** Opens another station in the room (the host's panel swap),
   *  carrying an optional panel payload — the cover-art door
   *  rides it. Absent only when a host mounts the bench without
   *  the room around it; the button then still renders, because
   *  the desk's own host always supplies it. */
  onOpenStation?: (stationId: string, payload?: PanelPayload | null) => void;
}

export function LocationsBench({ isLight, onOpenStation }: LocationsBenchProps) {
  const { t } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  const [locations, setLocations] = useState<SavedLocation[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [label, setLabel] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(LOCATIONS_PATH, { headers: await authHeaders(), credentials: "include" });
      if (!res.ok) throw new Error("load");
      const parsed = locationsOf(await res.json().catch(() => null));
      if (parsed === null) throw new Error("load");
      if (!mountedRef.current) return;
      setLocations(parsed);
      setLoadFailed(false);
    } catch {
      if (!mountedRef.current) return;
      setLoadFailed(true);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load, reloadNonce]);

  async function handleAddByUrl() {
    const body = buildLocationBody(label, imageUrl);
    if (!body) {
      setError(t("locations.errNameUrl"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(LOCATIONS_PATH, {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("save");
      setLabel("");
      setImageUrl("");
      await load();
    } catch {
      setError(t("locations.errSave"));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  async function handleUpload(file: File) {
    const problem = locationUploadProblem(label, file.size);
    if (problem === "too-large") {
      setError(t("locations.errImageTooLarge"));
      return;
    }
    if (problem === "name-first") {
      setError(t("locations.errNameFirst"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("label", label.trim());
      fd.append("image", file);
      const res = await fetch(LOCATIONS_UPLOAD_PATH, {
        method: "POST",
        headers: await authHeaders(),
        credentials: "include",
        body: fd,
      });
      if (!res.ok) throw new Error("upload");
      setLabel("");
      setImageUrl("");
      await load();
    } catch {
      setError(t("locations.errUpload"));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(locationPath(id), {
        method: "DELETE",
        headers: await authHeaders(),
        credentials: "include",
      });
      if (!res.ok) throw new Error("delete");
      if (mountedRef.current) {
        setLocations((prev) => (prev ? prev.filter((l) => l.id !== id) : prev));
      }
    } catch {
      setError(t("locations.errDelete"));
    } finally {
      if (mountedRef.current) setDeletingId(null);
    }
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = isLight
    ? "rounded-xl border border-[#7A5A12]/30 bg-white/70 px-3 py-2 text-sm text-[#2a1e07] placeholder:text-[#6B5B36]/60 outline-none"
    : "rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none";

  return (
    <div className="space-y-4" data-testid="world-locations-bench">
      <div>
        <p className={`inline-flex items-center gap-2 text-base font-black ${strong}`}>
          <MapPin className="h-4 w-4 text-[#d4af37]" /> {t("locations.pageTitle")}
        </p>
        <p className={`text-xs ${muted}`}>{t("locations.subtitle")}</p>
      </div>

      <div className={`rounded-xl border p-3 ${cardCls}`}>
        <p className={`mb-2.5 inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider ${muted}`}>
          <Plus className="h-3.5 w-3.5" /> {t("locations.addLocation")}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label={t("locations.namePlaceholder")}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("locations.namePlaceholder")}
            disabled={saving}
            className={`${inputCls} min-w-[150px] flex-1`}
          />
          <input
            aria-label={t("locations.imageUrlPlaceholder")}
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder={t("locations.imageUrlPlaceholder")}
            disabled={saving}
            className={`${inputCls} min-w-[180px] flex-1`}
          />
          <button
            type="button"
            data-testid="world-locations-bench-save"
            onClick={() => void handleAddByUrl()}
            disabled={saving}
            className="bdv-touch-target inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-3.5 py-2 text-xs font-black text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {t("locations.save")}
          </button>
          <label
            className={`bdv-touch-target inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-black transition ${
              isLight
                ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                : "border-white/15 text-white/80 hover:text-white"
            } ${saving ? "pointer-events-none opacity-50" : ""}`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t("locations.uploadImage")}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={saving}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-500" data-testid="world-locations-bench-error">
          {error}
        </p>
      ) : null}

      {loadFailed ? (
        <NativeErrorState
          isLight={isLight}
          message={t("locations.errLoad")}
          onRetry={() => setReloadNonce((n) => n + 1)}
        />
      ) : locations === null ? (
        <NativeLoadingState isLight={isLight} />
      ) : locations.length === 0 ? (
        <NativeEmptyState isLight={isLight} message={t("locations.noLocations")} />
      ) : (
        <div className="grid grid-cols-2 gap-3" data-testid="world-locations-bench-gallery">
          {locations.map((l) => (
            <article key={l.id} className={`overflow-hidden rounded-xl border ${cardCls}`}>
              <div className={`relative aspect-video ${isLight ? "bg-[#C9A84C]/10" : "bg-black/60"}`}>
                <img
                  src={l.imageUrl}
                  alt={l.label}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
                <button
                  type="button"
                  data-testid={`world-locations-bench-delete-${l.id}`}
                  onClick={() => void handleDelete(l.id)}
                  disabled={deletingId === l.id}
                  title={t("locations.removeLocationTitle")}
                  aria-label={t("locations.removeLocationTitle")}
                  className="bdv-touch-target absolute right-2 top-2 rounded-lg border border-white/10 bg-black/70 p-1.5 text-white/70 transition hover:border-red-400/40 hover:text-red-400"
                >
                  {deletingId === l.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  data-testid={`world-locations-bench-cover-art-${l.id}`}
                  onClick={() =>
                    onOpenStation?.("cover-art-desk", coverArtScenePayload(coverArtSceneUrl(l)))
                  }
                  title={t("locations.useInCoverArt")}
                  aria-label={t("locations.useInCoverArt")}
                  className="bdv-touch-target absolute bottom-2 left-2 rounded-lg border border-white/10 bg-black/70 p-1.5 text-[#d4af37] transition hover:border-[#d4af37]/60 hover:text-[#f7dd7f]"
                >
                  <Disc3 className="h-4 w-4" />
                </button>
              </div>
              <p className={`truncate px-3 py-2 text-sm font-semibold ${strong}`}>{l.label}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
