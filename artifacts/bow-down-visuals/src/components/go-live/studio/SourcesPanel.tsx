/**
 * SourcesPanel — the source stack of the Preview scene (front of the
 * stack at the top of the list, like OBS) plus the selected source's
 * property editor: position/size (numeric — the preview canvas also
 * drags), opacity, fit, visibility, lock, and each type's own settings
 * (camera kit/chroma mode, image URL/upload, text styling, gradient,
 * media URL). Editing happens on Preview; Program only changes on a
 * transition — that's the point of studio mode.
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Lock,
  MonitorUp,
  Plus,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import type { Stage } from "@/lib/stream-kit/stage";
import {
  SOURCE_TYPE_LABELS,
  WIDGET_KIND_LABELS,
  type AvatarSettings,
  type FitMode,
  type SceneSource,
  type SourceType,
  type WidgetKind,
} from "@/lib/stream-kit/scenes";
import { AVATAR_CHARACTERS, type AvatarCharacterId } from "@/lib/stream-kit/avatar-rigs";
import {
  applyVaultCharacter,
  refreshVaultAvatarSettings,
  unlinkVaultCharacter,
} from "@/lib/stream-kit/avatar-vault";
import { fetchVaultCharacters, type VaultCharacter } from "@/lib/world/characters";
import { useAuth } from "@/contexts/AuthContext";
import StreamPackTray from "@/components/go-live/studio/StreamPackTray";
import { ClipContextMenu } from "@/components/editor/ClipContextMenu";
import { buildSourceContextItems } from "@/lib/studio-context-menu";

const FONT_OPTIONS = [
  "Georgia, serif",
  "Arial, sans-serif",
  "Verdana, sans-serif",
  "Impact, sans-serif",
  "Courier New, monospace",
  "Times New Roman, serif",
];

export default function SourcesPanel({
  stage,
  isLight,
  selectedId,
  onSelect,
  onStartScreenShare,
  onStopScreenShare,
  screenSharing,
  onNotify,
}: {
  stage: Stage;
  isLight: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStartScreenShare: (sourceId: string) => void;
  onStopScreenShare: () => void;
  screenSharing: boolean;
  onNotify: (msg: string) => void;
}) {
  const scene = stage.previewScene();
  const { getAccessToken } = useAuth();
  const [menu, setMenu] = useState<{ x: number; y: number; sourceId: string } | null>(null);
  const [addType, setAddType] = useState<SourceType>("text");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const label = isLight ? "text-[#6B5B36]" : "text-zinc-400";
  const inputCls = `w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:border-[#C9A84C] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2A1E07]"
      : "border-white/15 bg-black/40 text-zinc-100"
  }`;
  const selected = scene.sources.find((s) => s.id === selectedId) ?? null;

  const update = (source: SceneSource, patch: Partial<SceneSource>) =>
    stage.updateSource(scene.id, source.id, patch);

  /* Creative Vault roster for the avatar picker — the same read the
     studio picker and the World use. Fetched once, the first time an
     avatar source is edited; [] means "loaded, none / unavailable"
     and the stock characters below simply stand alone. */
  const [vaultCharacters, setVaultCharacters] = useState<VaultCharacter[] | null>(null);
  const vaultFetchStarted = useRef(false);
  const editingAvatar = selected?.type === "avatar";
  useEffect(() => {
    if (!editingAvatar || vaultFetchStarted.current) return;
    vaultFetchStarted.current = true;
    let cancelled = false;
    fetchVaultCharacters(getAccessToken)
      .then((chars) => {
        if (!cancelled) setVaultCharacters(chars);
      })
      .catch(() => {
        if (!cancelled) setVaultCharacters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [editingAvatar, getAccessToken]);

  /* A vault-linked avatar re-resolves against the fresh roster the
     moment it lands — a portrait edited in the vault reaches the
     stream without re-picking the character. */
  const selectedAvatar = selected?.type === "avatar" ? selected.avatar : undefined;
  useEffect(() => {
    if (!vaultCharacters || !selected || selected.type !== "avatar" || !selected.avatar) return;
    const next = refreshVaultAvatarSettings(selected.avatar, vaultCharacters);
    if (next) update(selected, { avatar: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    vaultCharacters,
    selected?.id,
    selectedAvatar?.vaultId,
    selectedAvatar?.imageUrl,
    selectedAvatar?.vaultName,
  ]);

  const addSource = () => {
    const created = stage.addSource(scene.id, addType);
    if (!created) return;
    onSelect(created.id);
    if (addType === "screen") onStartScreenShare(created.id);
  };

  /* Right-click rename: select the source, then take the new name and
     apply it through the same update the name field uses. */
  const renameSource = (source: SceneSource) => {
    onSelect(source.id);
    const next = window.prompt("Rename source", source.name);
    if (next && next.trim()) update(source, { name: next.trim().slice(0, 80) });
  };

  const removeSource = (source: SceneSource) => {
    stage.removeSource(scene.id, source.id);
    if (selectedId === source.id) onSelect(null);
  };

  const frontFirst = [...scene.sources].reverse();

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${label}`}>
          Sources · {scene.name} (Preview)
        </p>
      </div>

      <div className="mb-2 flex gap-1.5">
        <select
          value={addType}
          onChange={(e) => setAddType(e.target.value as SourceType)}
          className={`min-w-0 flex-1 ${inputCls}`}
          aria-label="Source type to add"
        >
          {(Object.keys(SOURCE_TYPE_LABELS) as SourceType[]).map((t) => (
            <option key={t} value={t}>
              {SOURCE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addSource}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#C9A84C]/50 px-2 py-1.5 text-[11px] font-semibold text-[#8a6d1f] transition hover:bg-[#C9A84C]/10 dark:text-[#e8cf8a]"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>

      <div className="space-y-1.5">
        {frontFirst.length === 0 && (
          <p className={`rounded-lg border border-dashed px-3 py-3 text-center text-xs ${isLight ? "border-[#C9A84C]/30 text-[#6B5B36]" : "border-white/15 text-zinc-500"}`}>
            This scene is empty — add a source above.
          </p>
        )}
        {frontFirst.map((source) => (
          <div
            key={source.id}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(source.id);
              setMenu({ x: e.clientX, y: e.clientY, sourceId: source.id });
            }}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-sm ${
              selectedId === source.id
                ? "border-[#C9A84C]/70 bg-[#C9A84C]/10"
                : isLight
                  ? "border-[#C9A84C]/25 bg-white/40"
                  : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <button
              type="button"
              className={`min-w-0 flex-1 truncate text-left font-medium ${isLight ? "text-[#2A1E07]" : "text-zinc-100"}`}
              onClick={() => onSelect(source.id)}
              title={`${SOURCE_TYPE_LABELS[source.type]} — click to edit`}
            >
              {source.name}
              <span className={`ml-1.5 text-[10px] uppercase ${label}`}>{SOURCE_TYPE_LABELS[source.type]}</span>
            </button>
            <button type="button" title="Move toward front" onClick={() => stage.moveSourceById(scene.id, source.id, 1)} className="rounded p-1 text-zinc-400 transition hover:text-[#C9A84C]">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="Move toward back" onClick={() => stage.moveSourceById(scene.id, source.id, -1)} className="rounded p-1 text-zinc-400 transition hover:text-[#C9A84C]">
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={source.visible ? "Hide source" : "Show source"}
              onClick={() => update(source, { visible: !source.visible })}
              className="rounded p-1 text-zinc-400 transition hover:text-[#C9A84C]"
            >
              {source.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-red-400" />}
            </button>
            <button
              type="button"
              title={source.locked ? "Unlock (locked sources can't be dragged)" : "Lock position"}
              onClick={() => update(source, { locked: !source.locked })}
              className="rounded p-1 text-zinc-400 transition hover:text-[#C9A84C]"
            >
              {source.locked ? <Lock className="h-3.5 w-3.5 text-[#C9A84C]" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              title="Remove source"
              onClick={() => {
                stage.removeSource(scene.id, source.id);
                if (selectedId === source.id) onSelect(null);
              }}
              className="rounded p-1 text-zinc-400 transition hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <StreamPackTray
        stage={stage}
        isLight={isLight}
        onSelect={onSelect}
        onNotify={onNotify}
      />

      {selected && (
        <div className={`mt-3 space-y-2.5 rounded-lg border p-3 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
          <input
            value={selected.name}
            onChange={(e) => update(selected, { name: e.target.value })}
            className={inputCls}
            aria-label="Source name"
          />
          <div className="grid grid-cols-4 gap-1.5">
            {(["x", "y", "w", "h"] as const).map((k) => (
              <label key={k} className={`text-[10px] font-semibold uppercase ${label}`}>
                {k === "w" ? "Width %" : k === "h" ? "Height %" : `${k.toUpperCase()} %`}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(selected[k] * 100)}
                  onChange={(e) => {
                    const v = Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100;
                    update(selected, { [k]: v } as Partial<SceneSource>);
                  }}
                  className={`mt-0.5 ${inputCls}`}
                />
              </label>
            ))}
          </div>
          <label className={`block text-[10px] font-semibold uppercase ${label}`}>
            Opacity {Math.round(selected.opacity * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(selected.opacity * 100)}
              onChange={(e) => update(selected, { opacity: Number(e.target.value) / 100 })}
              className="mt-1 w-full accent-[#C9A84C]"
            />
          </label>
          {selected.type !== "text" && selected.type !== "color" && (
            <label className={`block text-[10px] font-semibold uppercase ${label}`}>
              Fit
              <select
                value={selected.fit}
                onChange={(e) => update(selected, { fit: e.target.value as FitMode })}
                className={`mt-0.5 ${inputCls}`}
              >
                <option value="cover">Cover (crop to fill)</option>
                <option value="contain">Contain (letterbox)</option>
                <option value="stretch">Stretch</option>
              </select>
            </label>
          )}

          {selected.type === "widget" && (
            <label className={`block text-[10px] font-semibold uppercase ${label}`}>
              Widget
              <select
                value={selected.widget?.kind ?? "latest-follower"}
                onChange={(e) => {
                  const kind = e.target.value as WidgetKind;
                  update(selected, { widget: { kind }, name: WIDGET_KIND_LABELS[kind] });
                }}
                className={`mt-0.5 ${inputCls}`}
                data-testid="widget-kind"
              >
                {(Object.keys(WIDGET_KIND_LABELS) as WidgetKind[]).map((k) => (
                  <option key={k} value={k}>
                    {WIDGET_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block normal-case text-white/40">
                Renders live stream data on Program. With no data yet it stays invisible on the feed — the
                Widgets panel below the chat shows the real numbers.
              </span>
            </label>
          )}

          {selected.type === "camera" && (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                {(
                  [
                    ["kit", "Studio backdrop"],
                    ["chroma", "Green screen"],
                  ] as const
                ).map(([mode, text]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => update(selected, { cameraMode: mode })}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition ${
                      selected.cameraMode === mode
                        ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#8a6d1f] dark:text-[#e8cf8a]"
                        : isLight
                          ? "border-[#C9A84C]/30 text-[#6B5B36]"
                          : "border-white/15 text-zinc-400"
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {selected.cameraMode === "chroma" && selected.chroma && (
                <div className="space-y-2">
                  <label className={`flex items-center gap-2 text-[10px] font-semibold uppercase ${label}`}>
                    Key color
                    <input
                      type="color"
                      value={selected.chroma.color}
                      onChange={(e) => update(selected, { chroma: { ...selected.chroma!, color: e.target.value } })}
                      className="h-7 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
                    />
                  </label>
                  <label className={`block text-[10px] font-semibold uppercase ${label}`}>
                    Similarity {Math.round(selected.chroma.similarity * 100)}
                    <input
                      type="range"
                      min={0}
                      max={90}
                      value={Math.round(selected.chroma.similarity * 100)}
                      onChange={(e) => update(selected, { chroma: { ...selected.chroma!, similarity: Number(e.target.value) / 100 } })}
                      className="mt-1 w-full accent-[#C9A84C]"
                    />
                  </label>
                  <label className={`block text-[10px] font-semibold uppercase ${label}`}>
                    Smoothness {Math.round(selected.chroma.smoothness * 100)}
                    <input
                      type="range"
                      min={0}
                      max={60}
                      value={Math.round(selected.chroma.smoothness * 100)}
                      onChange={(e) => update(selected, { chroma: { ...selected.chroma!, smoothness: Number(e.target.value) / 100 } })}
                      className="mt-1 w-full accent-[#C9A84C]"
                    />
                  </label>
                  <p className={`text-[11px] leading-snug ${label}`}>
                    Green screen mode keys the raw camera — point it at a green backdrop and tune Similarity until the
                    backdrop disappears, then Smoothness to soften the edge.
                  </p>
                </div>
              )}
            </div>
          )}

          {selected.type === "avatar" && selected.avatar && (
            <div className="space-y-2">
              {vaultCharacters !== null && vaultCharacters.length > 0 && (
                <div>
                  <p className={`mb-1 text-[10px] font-semibold uppercase ${label}`}>
                    Go live as your character
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {vaultCharacters.map((c) => {
                      const linked = selected.avatar!.vaultId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={!c.portraitUrl}
                          onClick={() =>
                            update(selected, { avatar: applyVaultCharacter(selected.avatar!, c) })
                          }
                          className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
                            linked
                              ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#8a6d1f] dark:text-[#e8cf8a]"
                              : isLight
                                ? "border-[#C9A84C]/30 text-[#6B5B36]"
                                : "border-white/15 text-zinc-400"
                          }`}
                          data-testid={`avatar-vault-${c.id}`}
                        >
                          {c.portraitUrl ? (
                            <img
                              src={c.portraitUrl}
                              alt=""
                              className="h-5 w-5 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#C9A84C]/20 text-[9px] font-black text-[#8a6d1f] dark:text-[#e8cf8a]">
                              {c.name.charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0 truncate">{c.name}</span>
                        </button>
                      );
                    })}
                  </div>
                  {selected.avatar.vaultId ? (
                    <p className={`mt-1 text-[11px] leading-snug ${label}`}>
                      Streaming as{" "}
                      <span className="font-semibold">{selected.avatar.vaultName}</span> — the
                      portrait comes from your Creative Vault; edit it there and the stream
                      picks it up.
                    </p>
                  ) : vaultCharacters.some((c) => !c.portraitUrl) ? (
                    <p className={`mt-1 text-[11px] leading-snug ${label}`}>
                      Characters without a portrait can't perform yet — add one in the Creative
                      Vault.
                    </p>
                  ) : null}
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5">
                {AVATAR_CHARACTERS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      update(selected, {
                        avatar: {
                          ...unlinkVaultCharacter(selected.avatar!),
                          character: c.id as AvatarCharacterId,
                        },
                      })
                    }
                    className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition ${
                      selected.avatar!.character === c.id
                        ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#8a6d1f] dark:text-[#e8cf8a]"
                        : isLight
                          ? "border-[#C9A84C]/30 text-[#6B5B36]"
                          : "border-white/15 text-zinc-400"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {selected.avatar.character === "upload" && (
                <div className="space-y-1.5">
                  <input
                    value={selected.avatar.imageUrl ?? ""}
                    onChange={(e) =>
                      update(selected, {
                        avatar: {
                          ...unlinkVaultCharacter(selected.avatar!),
                          imageUrl: e.target.value,
                        },
                      })
                    }
                    placeholder="Picture URL — or upload below (PNG with transparency reads best)"
                    className={inputCls}
                  />
                  <input
                    ref={avatarFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        update(selected, {
                          avatar: {
                            ...unlinkVaultCharacter(selected.avatar!),
                            imageUrl: URL.createObjectURL(file),
                          },
                        });
                        onNotify("Your picture is the character now.");
                      }
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => avatarFileRef.current?.click()}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#C9A84C]/50 px-2 py-1.5 text-[11px] font-semibold text-[#8a6d1f] transition hover:bg-[#C9A84C]/10 dark:text-[#e8cf8a]"
                  >
                    <Upload className="h-3.5 w-3.5" /> Upload your character picture
                  </button>
                </div>
              )}

              <div>
                <p className={`mb-1 text-[10px] font-semibold uppercase ${label}`}>How it moves</p>
                <div className="flex gap-1.5">
                  {(
                    [
                      ["face", "Face"],
                      ["voice", "Voice"],
                      ["idle", "Idle"],
                    ] as Array<[AvatarSettings["drive"], string]>
                  ).map(([mode, text]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => update(selected, { avatar: { ...selected.avatar!, drive: mode } })}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition ${
                        selected.avatar!.drive === mode
                          ? "border-[#C9A84C] bg-[#C9A84C]/15 text-[#8a6d1f] dark:text-[#e8cf8a]"
                          : isLight
                            ? "border-[#C9A84C]/30 text-[#6B5B36]"
                            : "border-white/15 text-zinc-400"
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>

              <label className={`block text-[10px] font-semibold uppercase ${label}`}>
                Expression {Math.round(selected.avatar.sensitivity * 100)}%
                <input
                  type="range"
                  min={50}
                  max={150}
                  value={Math.round(selected.avatar.sensitivity * 100)}
                  onChange={(e) =>
                    update(selected, {
                      avatar: { ...selected.avatar!, sensitivity: Number(e.target.value) / 100 },
                    })
                  }
                  className="mt-1 w-full accent-[#C9A84C]"
                />
              </label>

              {(() => {
                const st = stage.pool.avatarStatusFor(selected);
                const modeText =
                  st.mode === "face" ? "Face tracking" : st.mode === "voice" ? "Voice drive" : "Idling";
                return (
                  <p className={`text-[11px] leading-snug ${label}`} data-testid="avatar-status">
                    Moving by: <span className="font-semibold">{modeText}</span>
                    {st.engine === "loading" && st.requested === "face" ? " · face tracking is loading…" : ""}
                    {st.fellBack && st.reason ? ` — ${st.reason}` : ""}
                  </p>
                );
              })()}

              <p className={`text-[11px] leading-snug ${label}`}>
                Your camera is only used to move the character — it's never shown on the stream. Face mode
                needs the camera started; with no camera, your voice moves the character, and with neither it
                breathes and blinks on its own.
              </p>
            </div>
          )}

          {selected.type === "screen" && (
            <div className="space-y-1.5">
              {screenSharing ? (
                <button
                  type="button"
                  onClick={onStopScreenShare}
                  className="w-full rounded-md border border-red-400/50 px-2 py-1.5 text-[11px] font-semibold text-red-500 transition hover:bg-red-500/10"
                >
                  Stop screen share
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onStartScreenShare(selected.id)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#C9A84C]/50 px-2 py-1.5 text-[11px] font-semibold text-[#8a6d1f] transition hover:bg-[#C9A84C]/10 dark:text-[#e8cf8a]"
                >
                  <MonitorUp className="h-3.5 w-3.5" /> Start screen / window share
                </button>
              )}
              <p className={`text-[11px] leading-snug ${label}`}>
                The browser asks which screen or window to share. If you share a tab or window with sound, its audio
                joins the mixer.
              </p>
            </div>
          )}

          {selected.type === "image" && (
            <div className="space-y-1.5">
              <input
                value={selected.imageUrl ?? ""}
                onChange={(e) => update(selected, { imageUrl: e.target.value })}
                placeholder="Image URL — or upload below"
                className={inputCls}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    update(selected, { imageUrl: URL.createObjectURL(file) });
                    onNotify("Image added from your device.");
                  }
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#C9A84C]/50 px-2 py-1.5 text-[11px] font-semibold text-[#8a6d1f] transition hover:bg-[#C9A84C]/10 dark:text-[#e8cf8a]"
              >
                <Upload className="h-3.5 w-3.5" /> Upload an image
              </button>
            </div>
          )}

          {selected.type === "media" && (
            <div className="space-y-1.5">
              <input
                value={selected.mediaUrl ?? ""}
                onChange={(e) => update(selected, { mediaUrl: e.target.value })}
                placeholder="Direct media URL (video or image file)"
                className={inputCls}
              />
              <p className={`text-[11px] leading-snug ${label}`}>
                Plays a media file straight from its URL — a video clip, a GIF, an image. Page links and embeds can't
                run in the studio; if a URL won't load as media, the source says so on the canvas.
              </p>
            </div>
          )}

          {selected.type === "text" && selected.text && (
            <div className="space-y-2">
              <textarea
                value={selected.text.content}
                onChange={(e) => update(selected, { text: { ...selected.text!, content: e.target.value } })}
                rows={2}
                className={inputCls}
                aria-label="Text content"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <label className={`text-[10px] font-semibold uppercase ${label}`}>
                  Font
                  <select
                    value={selected.text.fontFamily}
                    onChange={(e) => update(selected, { text: { ...selected.text!, fontFamily: e.target.value } })}
                    className={`mt-0.5 ${inputCls}`}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f.split(",")[0]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`text-[10px] font-semibold uppercase ${label}`}>
                  Text color
                  <input
                    type="color"
                    value={selected.text.color}
                    onChange={(e) => update(selected, { text: { ...selected.text!, color: e.target.value } })}
                    className="mt-0.5 h-9 w-full cursor-pointer rounded border border-white/20 bg-transparent"
                  />
                </label>
              </div>
              <label className={`block text-[10px] font-semibold uppercase ${label}`}>
                Size {selected.text.fontSize}px
                <input
                  type="range"
                  min={16}
                  max={140}
                  value={selected.text.fontSize}
                  onChange={(e) => update(selected, { text: { ...selected.text!, fontSize: Number(e.target.value) } })}
                  className="mt-1 w-full accent-[#C9A84C]"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => update(selected, { text: { ...selected.text!, bold: !selected.text!.bold } })}
                  className={`rounded-md border px-2 py-1 text-[11px] font-bold ${selected.text.bold ? "border-[#C9A84C] bg-[#C9A84C]/15" : isLight ? "border-[#C9A84C]/30" : "border-white/15"}`}
                >
                  B
                </button>
                <label className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase ${label}`}>
                  Outline
                  <input
                    type="color"
                    value={selected.text.outlineColor ?? "#000000"}
                    onChange={(e) => update(selected, { text: { ...selected.text!, outlineColor: e.target.value } })}
                    className="h-7 w-10 cursor-pointer rounded border border-white/20 bg-transparent"
                  />
                </label>
                {selected.text.outlineColor && (
                  <button
                    type="button"
                    onClick={() => update(selected, { text: { ...selected.text!, outlineColor: null } })}
                    className={`text-[11px] underline ${label}`}
                  >
                    No outline
                  </button>
                )}
              </div>
            </div>
          )}

          {selected.type === "color" && selected.fill && (
            <div className="grid grid-cols-2 gap-1.5">
              <label className={`text-[10px] font-semibold uppercase ${label}`}>
                Top color
                <input
                  type="color"
                  value={selected.fill.from}
                  onChange={(e) => update(selected, { fill: { ...selected.fill!, from: e.target.value } })}
                  className="mt-0.5 h-9 w-full cursor-pointer rounded border border-white/20 bg-transparent"
                />
              </label>
              <label className={`text-[10px] font-semibold uppercase ${label}`}>
                Bottom color
                <input
                  type="color"
                  value={selected.fill.to}
                  onChange={(e) => update(selected, { fill: { ...selected.fill!, to: e.target.value } })}
                  className="mt-0.5 h-9 w-full cursor-pointer rounded border border-white/20 bg-transparent"
                />
              </label>
              <p className={`col-span-2 text-[11px] ${label}`}>Same color top and bottom = a solid backdrop.</p>
            </div>
          )}
        </div>
      )}
      {menu && (() => {
        const source = scene.sources.find((s) => s.id === menu.sourceId);
        if (!source) return null;
        return (
          <ClipContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            testId="source-context-menu"
            items={buildSourceContextItems(stage, scene, source, {
              onSelect,
              onRename: renameSource,
              onRemove: removeSource,
            })}
          />
        );
      })()}
    </div>
  );
}
