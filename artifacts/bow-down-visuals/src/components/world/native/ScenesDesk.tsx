/**
 * ScenesDesk — the Community Hall's native Local Scenes desk
 * (stack1500 world parity wave #3, census item 16).
 *
 * The house's map of real local scenes, browsed in the room:
 * the directory of cities real creators declared, and each
 * city's page — its creators, its real upcoming shows, and
 * its own chart (today / this week / all time), counted by
 * the same rails as the main charts.
 *
 * Both rails are public — no account, no charge, guests
 * browse in full. The directory rule holds in the room: a
 * city exists here only because a real creator claimed it,
 * and an unknown city says "No scene here yet" plainly,
 * exactly like the website.
 */
import { useCallback, useEffect, useState } from "react";
import {
  SCENE_WINDOWS,
  cityRowOf,
  fetchScene,
  fetchSceneDirectory,
  sceneDetailOf,
  type SceneCityRow,
  type SceneDetail,
  type SceneWindow,
} from "@/lib/world/scenes-desk";

export function ScenesDesk({ isLight }: { isLight: boolean }) {
  const [cities, setCities] = useState<SceneCityRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<SceneWindow>("all");
  const [detail, setDetail] = useState<SceneDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "noscene">("idle");

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

  const loadDirectory = useCallback(async () => {
    try {
      const rows = (await fetchSceneDirectory()).map(cityRowOf).filter((r): r is SceneCityRow => r !== null);
      setCities(rows);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const openCity = useCallback(async (slug: string, win: SceneWindow) => {
    setSelected(slug);
    setDetailState("loading");
    const page = await fetchScene(slug, win);
    const shaped = sceneDetailOf(page);
    if (!shaped) {
      setDetail(null);
      setDetailState("noscene");
      return;
    }
    setDetail(shaped);
    setDetailState("ready");
  }, []);

  useEffect(() => {
    if (selected) void openCity(selected, windowKey);
  }, [selected, windowKey, openCity]);

  if (loadFailed) {
    return (
      <div className="space-y-3" data-testid="world-scenes-desk">
        <p className={`text-base font-black ${strong}`}>Local Scenes</p>
        <p className={errCls} data-testid="world-scenes-desk-failed">
          The scene map wouldn&rsquo;t load. Give it another shot.
        </p>
        <button type="button" className={chipCls(false)} onClick={() => void loadDirectory()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="world-scenes-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>Local Scenes</p>
        <p className={`text-xs ${muted}`}>
          Real cities, claimed by real creators — their people, their shows, their chart.
        </p>
      </div>

      {cities === null ? (
        <p className={`text-sm ${muted}`}>Reading the scene map…</p>
      ) : cities.length === 0 ? (
        <p className={`text-sm ${muted}`} data-testid="world-scenes-desk-empty">
          No scenes yet — a city appears here the moment a creator declares it on their profile.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5" data-testid="world-scenes-desk-directory">
          {cities.map((city) => (
            <button
              key={city.slug}
              type="button"
              data-testid={`world-scenes-desk-city-${city.slug}`}
              className={chipCls(selected === city.slug)}
              onClick={() => setSelected(city.slug)}
            >
              {city.name} · {city.creatorCount} creator{city.creatorCount === 1 ? "" : "s"}
              {city.showCount > 0 ? ` · ${city.showCount} shows` : ""}
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <section>
          <div className="flex flex-wrap items-center gap-1.5">
            {SCENE_WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                data-testid={`world-scenes-desk-window-${w.key}`}
                className={chipCls(windowKey === w.key)}
                onClick={() => setWindowKey(w.key)}
              >
                {w.label}
              </button>
            ))}
            <button type="button" className={`ml-auto ${chipCls(false)}`} onClick={() => setSelected(null)}>
              All scenes
            </button>
          </div>

          {detailState === "loading" ? (
            <p className={`mt-2 text-sm ${muted}`}>Opening the scene…</p>
          ) : detailState === "noscene" ? (
            <p className={`mt-2 text-sm ${muted}`} data-testid="world-scenes-desk-noscene">
              No scene here yet — no creator has declared this city, so there&rsquo;s no scene page
              for it. A city gets a page the moment a real creator claims it.
            </p>
          ) : detail ? (
            <div className="mt-3 space-y-4" data-testid="world-scenes-desk-detail">
              <p className={`text-sm font-bold ${strong}`}>
                {detail.name} — {detail.counts.creators} creators · {detail.counts.shows} shows ·{" "}
                {detail.counts.tracks} tracks · {detail.counts.videos} videos
              </p>

              <div>
                <p className={`text-sm font-bold ${strong}`}>The scene&rsquo;s creators</p>
                {detail.creators.length === 0 ? (
                  <p className={`mt-1 text-sm ${muted}`}>No creators listed for this scene yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {detail.creators.map((c) => (
                      <li key={c.profileId} className={`rounded-xl border px-3 py-2 ${cardCls}`}>
                        <span className={`text-sm font-bold ${strong}`}>{c.displayName}</span>
                        <span className={`ml-2 text-xs ${muted}`}>
                          {c.vertical ? `${c.vertical} · ` : ""}
                          {c.followerCount.toLocaleString()} followers · {c.totalPlays.toLocaleString()} plays
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className={`text-sm font-bold ${strong}`}>Coming up</p>
                {detail.shows.length === 0 ? (
                  <p className={`mt-1 text-sm ${muted}`}>No shows on the books for this scene yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {detail.shows.map((s) => (
                      <li key={s.id} className={`rounded-xl border px-3 py-2 ${cardCls}`}>
                        <span className={`text-sm font-bold ${strong}`}>{s.venue}</span>
                        <span className={`ml-2 text-xs ${muted}`}>
                          {s.dateLabel}
                          {s.displayName ? ` · ${s.displayName}` : ""}
                          {s.status ? ` · ${s.status}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className={`text-sm font-bold ${strong}`}>Scene chart — tracks</p>
                  {detail.tracks.length === 0 ? (
                    <p className={`mt-1 text-sm ${muted}`}>No tracks charting in this window yet.</p>
                  ) : (
                    <ol className="mt-2 space-y-1">
                      {detail.tracks.map((t, i) => (
                        <li key={t.id} className={`text-sm ${muted}`}>
                          <span className={`font-bold ${strong}`}>{i + 1}.</span> {t.title}
                          {t.genre ? ` · ${t.genre}` : ""} — {t.plays.toLocaleString()} plays ·{" "}
                          {t.likes.toLocaleString()} likes
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div>
                  <p className={`text-sm font-bold ${strong}`}>Scene chart — videos</p>
                  {detail.videos.length === 0 ? (
                    <p className={`mt-1 text-sm ${muted}`}>No videos charting in this window yet.</p>
                  ) : (
                    <ol className="mt-2 space-y-1">
                      {detail.videos.map((v, i) => (
                        <li key={v.id} className={`text-sm ${muted}`}>
                          <span className={`font-bold ${strong}`}>{i + 1}.</span> {v.title}
                          {v.genre ? ` · ${v.genre}` : ""} — {v.plays.toLocaleString()} views ·{" "}
                          {v.likes.toLocaleString()} likes
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
