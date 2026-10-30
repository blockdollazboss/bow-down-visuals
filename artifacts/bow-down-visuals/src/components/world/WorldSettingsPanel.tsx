import {
  Bell,
  BellOff,
  Eye,
  Gamepad2,
  Gauge,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  actionPageById,
  type ActionPageId,
} from "@/lib/world/bindings";
import {
  padWord,
  type ControllerFamily,
  type ControllerProfile,
} from "@/lib/world/controller-profile";
import {
  qualityPreferenceLabel,
  type QualityPreference,
} from "@/lib/world/quality";
import type { HallViewMode } from "@/lib/world/view-mode";
import {
  withWorldVolumeLevel,
  withWorldVolumeMuted,
  type WorldVolume,
} from "@/lib/world/volume";

/* ─── World settings — the World's own settings home (stack900) ────
   The owner's ruling (2026-10-29): settings for the World live
   INSIDE the World — not out on the web page, and not scattered
   across the little bars at the top and bottom of the screen.
   This panel is that home: one proper panel under the page root
   (the fullscreen element — opening it never costs the walker
   their fullscreen), opened from the single Settings & help door
   in the footer, worked by the controller like every other World
   panel (the page's fifth panel-nav family).

   Every control here writes through the SAME store its scattered
   twin already used — the view through the page's viewMode state
   (which persists via storeViewMode and drives the scene), the
   announcements switch through the header toggle's own handler,
   quality through the footer's own cycle, fullscreen through the
   header button's own toggleFs. The panel is a second door to
   the same rooms, never a second truth. What the census found no
   store for (the radio's open state is session-only) is simply
   not here. The Sound section's second row — the World volume —
   arrived with lane G3's real master store (lib/world/volume):
   it rides the same second-door pattern, passed in as props, and
   the panel still persists nothing itself.

   Sections, in the ruling's order: Controller (the pad in hand,
   named by B1's reactive profile store; the button map's row
   stands first when the map exists), View, Sound, Help (the old
   footer help strip's full content, readable at last), Display. */

const FAMILY_WORDS: Record<ControllerFamily, string> = {
  playstation: "PlayStation",
  xbox: "Xbox",
  switch: "Nintendo Switch",
  generic: "Controller",
};

export interface WorldSettingsPanelProps {
  isLight: boolean;
  /** B1's reactive profile: the pad in hand, its family, and the
   *  names every prompt speaks. Null id = no pad connected. */
  padProfile: ControllerProfile;
  isGuest: boolean;
  /** The action deck's current page (the help line names it). */
  actionPage: ActionPageId;
  viewMode: HallViewMode;
  onViewModeChange: (mode: HallViewMode) => void;
  qualityPref: QualityPreference;
  onCycleQuality: () => void;
  announceMuted: boolean;
  onToggleAnnounceMuted: () => void;
  /** The World master volume (lane G3's store, second door): the
   *  page's mirrored state + the store's own setter, so this row
   *  and the header's mute button can never disagree. */
  worldVolume: WorldVolume;
  onWorldVolumeChange: (next: WorldVolume) => void;
  isFs: boolean;
  fsSupported: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  /** The button map seam (lane B6): when the map panel exists in
   *  the tree, the page passes this and the Controller section
   *  opens with the map's row. While it is absent the row is
   *  omitted entirely — never a door that opens onto nothing. */
  buttonMap?: { onOpen: () => void };
}

function Section({
  title,
  isLight,
  children,
  wide,
}: {
  title: string;
  isLight: boolean;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={wide ? "md:col-span-2" : undefined}>
      <h3
        className={`text-[11px] font-black uppercase tracking-[0.14em] ${
          isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
        }`}
      >
        {title}
      </h3>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function WorldSettingsPanel(props: WorldSettingsPanelProps) {
  const {
    isLight,
    padProfile,
    isGuest,
    actionPage,
    viewMode,
    onViewModeChange,
    qualityPref,
    onCycleQuality,
    announceMuted,
    onToggleAnnounceMuted,
    worldVolume,
    onWorldVolumeChange,
    isFs,
    fsSupported,
    onToggleFullscreen,
    onClose,
    buttonMap,
  } = props;
  const padConnected = padProfile.gamepadId !== null;

  const pillCls = `bdv-touch-target inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
  const noteCls = `text-[11px] leading-tight ${
    isLight ? "text-[#6B5B36]" : "text-white/40"
  }`;

  return (
    <div
      className={`relative z-20 max-h-[70dvh] overflow-y-auto overscroll-contain border-t px-4 py-3 ${
        isLight
          ? "border-[#C9A84C]/50 bg-[#FBF6E9]"
          : "border-[#d4af37]/25 bg-[#070605]"
      }`}
      data-testid="world-settings-panel"
    >
      <div className="flex items-center gap-2">
        <h2
          className={`text-sm font-black ${
            isLight ? "text-[#2a1e07]" : "text-white"
          }`}
        >
          World settings
        </h2>
        <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          Everything about walking the palace — set from inside it.
        </span>
        <button
          type="button"
          data-testid="world-settings-close"
          onClick={onClose}
          aria-label="Close world settings"
          className={`ml-auto flex h-7 w-7 items-center justify-center rounded-full border transition ${
            isLight
              ? "border-[#7A5A12]/30 text-[#6B5B36] hover:bg-[#C9A84C]/15"
              : "border-white/15 text-white/70 hover:bg-white/10"
          }`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid gap-5 md:grid-cols-2">
        {/* ── Controller: the pad in hand, named; the map's row
            stands first when the map panel exists (B6 seam). ── */}
        <Section title="Controller" isLight={isLight}>
          {buttonMap && (
            <button
              type="button"
              data-testid="world-settings-button-map"
              onClick={buttonMap.onOpen}
              className={pillCls}
            >
              <Gamepad2 className="h-4 w-4 text-[#d4af37]" />
              Button map — what every button does
            </button>
          )}
          {padConnected ? (
            <p className={`text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
              {padProfile.displayName}
              <span className={noteCls}>
                {" "}
                · {FAMILY_WORDS[padProfile.family]} — every prompt in the
                World names this pad&rsquo;s own buttons.
              </span>
            </p>
          ) : (
            <p className={noteCls}>
              No controller connected. Press any button on your pad and
              the World learns its name — every prompt then speaks that
              pad&rsquo;s language.
            </p>
          )}
        </Section>

        {/* ── View: the camera, through the one shared store. ── */}
        <Section title="View" isLight={isLight}>
          <div
            role="group"
            aria-label="Camera view"
            className={`inline-flex items-center gap-1 self-start rounded-full border p-1 ${
              isLight ? "border-[#7A5A12]/40 bg-black/5" : "border-white/20 bg-white/5"
            }`}
          >
            {(
              [
                { mode: "third" as HallViewMode, label: "Third person", testId: "world-settings-view-third" },
                { mode: "first" as HallViewMode, label: "First person", testId: "world-settings-view-first" },
              ]
            ).map(({ mode, label, testId }) => (
              <button
                key={mode}
                type="button"
                data-testid={testId}
                aria-pressed={viewMode === mode}
                onClick={() => onViewModeChange(mode)}
                className={`bdv-touch-target rounded-full px-3 py-1.5 text-sm font-bold transition ${
                  viewMode === mode
                    ? "bg-[#d4af37] text-black"
                    : isLight
                      ? "text-[#6B5B36] hover:text-[#2a1e07]"
                      : "text-white/60 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className={noteCls}>
            Third person is the World&rsquo;s way — the camera rides
            behind your figure, so you can see who you&rsquo;re
            standing as. The choice is remembered on this device.
          </p>
        </Section>

        {/* ── Sound: two separate switches, one section — the
            palace announcements mute (the header toggle's own
            handler, its own device store) and, directly under
            it, the World master volume (lane G3's store, the
            header mute button's second door). Either can silence
            its own half without touching the other. ── */}
        <Section title="Sound" isLight={isLight}>
          <button
            type="button"
            role="switch"
            aria-checked={!announceMuted}
            data-testid="world-settings-announce"
            onClick={onToggleAnnounceMuted}
            className={`bdv-touch-target inline-flex items-center gap-2 self-start rounded-full border px-4 py-2 text-sm font-bold transition ${
              !announceMuted
                ? "border-[#d4af37] bg-[#d4af37] text-black hover:scale-105"
                : isLight
                  ? "border-[#7A5A12]/40 bg-black/5 text-[#6B5B36] hover:text-[#2a1e07]"
                  : "border-white/20 bg-white/5 text-white/60 hover:text-white"
            }`}
          >
            {announceMuted ? (
              <BellOff className="h-4 w-4" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
            Palace announcements {announceMuted ? "off" : "on"}
          </button>
          <p className={noteCls}>
            The palace speaks for drops, shows and the King&rsquo;s
            moment. Off silences the banner and its sting on this
            device — the room log still keeps the line.
          </p>
          <div className="flex items-center gap-2 self-start">
            <button
              type="button"
              role="switch"
              aria-checked={!worldVolume.muted}
              data-testid="world-settings-volume-mute"
              onClick={() => onWorldVolumeChange(withWorldVolumeMuted(worldVolume, !worldVolume.muted))}
              className={`bdv-touch-target inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
                !worldVolume.muted
                  ? "border-[#d4af37] bg-[#d4af37] text-black hover:scale-105"
                  : isLight
                    ? "border-[#7A5A12]/40 bg-black/5 text-[#6B5B36] hover:text-[#2a1e07]"
                    : "border-white/20 bg-white/5 text-white/60 hover:text-white"
              }`}
            >
              {worldVolume.muted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
              World volume {worldVolume.muted ? "muted" : "on"}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={worldVolume.level}
              data-testid="world-settings-volume-slider"
              aria-label="World volume"
              onChange={(e) => onWorldVolumeChange(withWorldVolumeLevel(worldVolume, Number(e.currentTarget.value)))}
              className="w-32 accent-[#d4af37]"
            />
            <span className={`text-xs font-bold ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
              {worldVolume.level}
            </span>
          </div>
          <p className={noteCls}>
            Two separate switches: announcements mute silences only
            the palace&rsquo;s voice; the World volume is the master
            for every World sound on this device. Either can silence
            its half without touching the other — and your
            phone&rsquo;s own mute still outranks both.
          </p>
        </Section>

        {/* ── Help: the help strip's full content, readable. The
            pad sentence below is the footer's old line, moved
            verbatim (one flowing span, the same member scoping) —
            it stopped being a strip and became a page you can
            actually read. ── */}
        <Section title="Help" isLight={isLight} wide>
          {padConnected ? (
            <p
              className={`flex items-start gap-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}
              data-testid="world-pad-line"
            >
              <Gamepad2 className="mt-px h-4 w-4 shrink-0 text-[#d4af37]" />
              <span>
                {padProfile.displayName} connected — left stick walks, right stick looks, trigger hurries, {!isGuest && `${padWord(padProfile, "confirm")} steps voice (off · proximity · lobby · deafen), `}{padWord(padProfile, "topFace")} switches view, {padWord(padProfile, "leftBumper")} works the prompt you&rsquo;re standing at{!isGuest && <>, D-pad and face buttons perform the <span className="text-[#e8c86a]">{actionPageById(actionPage).label}</span> actions below, {padWord(padProfile, "leftMenu")} switches the action page, {padWord(padProfile, "rightStickPress")} claims the moment</>}, {padWord(padProfile, "rightMenu")} opens these settings (hold it to frame a photo). In a panel, the D-pad moves, {padWord(padProfile, "confirm")} chooses and {padWord(padProfile, "back")} goes back; hold {padWord(padProfile, "leftMenu")} for full screen.
              </span>
            </p>
          ) : (
            <p
              className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}
              data-testid="world-keys-line"
            >
              WASD to walk · drag or click to look · Shift to hurry ·
              Space to jump · E opens what&rsquo;s in reach · P frames
              a photo. In a panel, Tab moves between the controls and
              Enter chooses. Connect a controller and the World speaks
              its language instead — every prompt names the buttons on
              your pad.
            </p>
          )}
          {/* The menu button + the clean screen (stack900): the
              owner's two asks, named where a walker looks for
              how things work. The pad sentence speaks the
              profile's own word for the button; without a pad,
              the door chip is the honest road in. */}
          <p
            className={`mt-2 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}
            data-testid="world-menu-line"
          >
            {padConnected ? (
              <>
                {padWord(padProfile, "rightMenu")} opens these settings from
                anywhere in the World — press it again to put them away.
                Leave the controls alone for a few seconds and the bars
                around the screen fade away while you play; any touch of
                the pad or the mouse brings them back.
              </>
            ) : (
              <>
                The Settings &amp; help chip below opens this panel from
                anywhere in the World. Leave the controls alone for a few
                seconds and the bars around the screen fade away while
                you play; any touch of the mouse or a connected pad
                brings them back.
              </>
            )}
          </p>
        </Section>

        {/* ── Display: fullscreen through the header button's own
            toggleFs, and the graphics quality cycle the footer's
            button turns — same state, same store. ── */}
        <Section title="Display" isLight={isLight}>
          <div className="flex flex-wrap items-center gap-2">
            {fsSupported && (
              <button
                type="button"
                data-testid="world-settings-fullscreen"
                aria-pressed={isFs}
                onClick={onToggleFullscreen}
                className={pillCls}
              >
                {isFs ? (
                  <Minimize className="h-4 w-4" />
                ) : (
                  <Maximize className="h-4 w-4" />
                )}
                {isFs ? "Exit full screen" : "Full screen"}
              </button>
            )}
            <button
              type="button"
              data-testid="world-settings-quality"
              aria-label="Graphics quality"
              title="Graphics quality — Auto adapts to your device"
              onClick={onCycleQuality}
              className={pillCls}
            >
              <Gauge className="h-4 w-4" />
              Quality: {qualityPreferenceLabel(qualityPref)}
            </button>
          </div>
          <p className={noteCls}>
            If full screen drops on its own — the browser&rsquo;s Esc,
            a system gesture — the next tap, or any button on your
            controller, brings it back. Leaving on purpose stays left.
            Quality on Auto adapts to your device.
          </p>
          <p className={noteCls}>
            <Eye className="mr-1 inline h-3.5 w-3.5 text-[#d4af37]" />
            Panels, desks and these settings all live inside the
            fullscreen — working in the World never costs you it.
          </p>
        </Section>
      </div>
    </div>
  );
}
