import { useEffect, useRef, useState } from "react";
import { Gamepad2, X } from "lucide-react";
import type { ActionPageId } from "@/lib/world/bindings";
import { actionPageById } from "@/lib/world/bindings";
import {
  padWord,
  type ControllerProfile,
} from "@/lib/world/controller-profile";
import {
  CONTROLLER_MAP_LAYOUTS,
  NOT_USED_IN_WORLD,
  controllerMapNodes,
  litNodeIds,
  type ControllerMapNode,
  type ControllerMapSpot,
} from "@/lib/world/controller-map";
import { firstGamepad } from "@/lib/world/gamepad";

/**
 * The controller map (stack900, owner's directive 2026-10-29:
 * "The controller button should have a map") — a drawn
 * picture of the pad actually in the player's hand, every
 * button labelled with its World job, that lights up under
 * the player's real presses.
 *
 * The drawing and the census are data (lib/world/controller-
 * map.ts): names from the pad's controller profile, jobs from
 * bindings.ts against the current action page. This component
 * paints them — an inline SVG schematic per family (the
 * DualSense's touchpad slab and low symmetric sticks, the
 * Xbox pad's high left stick, the Switch Pro's rotated face
 * letters ride in the seat positions) — and runs the live
 * highlight: its own rAF poll reads the same first pad the
 * scene reads and glows the node whose button is physically
 * down right now, diagram and job row together. Swap pads
 * mid-session and the page's profile store re-renders this
 * panel for the new family — the map is subscribed, never
 * snapshotted.
 *
 * Pad arbitration (stack700's bargain, kept): the page hands
 * this panel a usePanelPadNav reader like every other panel
 * family, and the scene stands its verbs down while it is
 * open. The panel's pad root is the map body alone
 * ([data-testid="world-controller-map"]) and it deliberately
 * contains NO focusable control — the one thing a player
 * does here is press buttons to watch them light, and the
 * confirm button must never land on a Close that eats the
 * press being demonstrated. Back (the panel poll's own verb)
 * is the pad's way out; the Close button above the root
 * serves the mouse, and Escape closes as panels do.
 */

interface Palette {
  bodyFill: string;
  bodyStroke: string;
  controlFill: string;
  controlStroke: string;
  nameFill: string;
  litFill: string;
  litStroke: string;
}

const PALETTES: Record<"light" | "dark", Palette> = {
  dark: {
    bodyFill: "#14100c",
    bodyStroke: "rgba(212,175,55,0.55)",
    controlFill: "#251c11",
    controlStroke: "#8a6d2f",
    nameFill: "#e8e0cc",
    litFill: "#d4af37",
    litStroke: "#ffe9a8",
  },
  light: {
    bodyFill: "#f6ecd2",
    bodyStroke: "#b8912f",
    controlFill: "#fffaf0",
    controlStroke: "#a5812c",
    nameFill: "#2a1e07",
    litFill: "#d4af37",
    litStroke: "#7A5A12",
  },
};

function NodeShape({
  node,
  spot,
  lit,
  palette,
}: {
  node: ControllerMapNode;
  spot: ControllerMapSpot;
  lit: boolean;
  palette: Palette;
}) {
  const fill = lit ? palette.litFill : palette.controlFill;
  const stroke = lit ? palette.litStroke : palette.controlStroke;
  const glow = lit
    ? { filter: "drop-shadow(0 0 7px rgba(212,175,55,0.95))" }
    : undefined;
  const labelY =
    spot.shape === "rect" ? spot.y + (spot.h ?? 0) / 2 + 26 : spot.y + spot.r + 15;
  return (
    <g data-map-node={node.id} style={glow}>
      {spot.shape === "stick" ? (
        <>
          <circle cx={spot.x} cy={spot.y} r={spot.r} fill={fill} stroke={stroke} strokeWidth={lit ? 2.5 : 1.5} />
          <circle cx={spot.x} cy={spot.y} r={spot.r * 0.55} fill="none" stroke={stroke} strokeWidth={1.2} />
        </>
      ) : spot.shape === "rect" || spot.shape === "dpadCell" ? (
        <rect
          x={spot.x - (spot.w ?? 0) / 2}
          y={spot.y - (spot.h ?? 0) / 2}
          width={spot.w ?? 0}
          height={spot.h ?? 0}
          rx={spot.r}
          fill={fill}
          stroke={stroke}
          strokeWidth={lit ? 2.5 : 1.5}
        />
      ) : (
        <circle cx={spot.x} cy={spot.y} r={spot.r} fill={fill} stroke={stroke} strokeWidth={lit ? 2.5 : 1.5} />
      )}
      {node.glyph ? (
        <text
          x={spot.x}
          y={spot.y + 5}
          textAnchor="middle"
          fontSize={15}
          fontWeight={700}
          fill={lit ? "#1a1408" : palette.nameFill}
        >
          {node.glyph}
        </text>
      ) : null}
      <text
        x={spot.x}
        y={labelY}
        textAnchor="middle"
        fontSize={10.5}
        fontWeight={600}
        fill={palette.nameFill}
        opacity={node.job === NOT_USED_IN_WORLD ? 0.55 : 0.92}
      >
        {node.name}
      </text>
    </g>
  );
}

export default function ControllerMapPanel({
  profile,
  actionPage,
  isLight,
  onClose,
}: {
  profile: ControllerProfile;
  actionPage: ActionPageId;
  isLight: boolean;
  onClose: () => void;
}) {
  const palette = isLight ? PALETTES.light : PALETTES.dark;
  const nodes = controllerMapNodes(profile, actionPage);
  const layout = CONTROLLER_MAP_LAYOUTS[profile.family];
  const pageLabel = actionPageById(actionPage).label;

  /* The live highlight: poll the first pad (the same pad the
   * scene and the store adopt) and light what it is doing.
   * State changes only when the lit set changes — a held
   * button costs one render, not one per frame. The node
   * list rides a ref so a family swap mid-hold re-derives
   * against the new census without restarting the poll. */
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [lit, setLit] = useState<ReadonlySet<string>>(new Set());
  const litKeyRef = useRef("");
  useEffect(() => {
    let raf = 0;
    let disposed = false;
    const loop = () => {
      if (disposed) return;
      try {
        const pad = firstGamepad([...(navigator.getGamepads?.() ?? [])]);
        const next = litNodeIds(pad, nodesRef.current);
        const key = [...next].sort().join(",");
        if (key !== litKeyRef.current) {
          litKeyRef.current = key;
          setLit(next);
        }
      } catch {
        /* no gamepad API — the map still reads, it just never lights */
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  /* Escape closes, as panels do — the pad's road is Back
   * (the panel poll), the mouse's is the Close button. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`relative z-20 max-h-[62vh] overflow-y-auto border-t px-4 py-3 ${
        isLight ? "border-[#C9A84C]/50 bg-[#FBF6E9]" : "border-[#d4af37]/25 bg-[#070605]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-2 text-sm font-black ${
            isLight ? "text-[#2a1e07]" : "text-white"
          }`}
        >
          <Gamepad2 className="h-4 w-4 text-[#d4af37]" />
          {profile.displayName} — controller map
        </span>
        <span className={`text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          Press any button on your pad — it lights up here, so you can see the map matches your hand.
          The action buttons are showing the <span className="text-[#d4af37]">{pageLabel}</span> page —{" "}
          {padWord(profile, "leftMenu")} switches it. {padWord(profile, "back")} closes the map.
        </span>
        <button
          type="button"
          data-testid="world-controller-map-close"
          onClick={onClose}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition hover:scale-105 ${
            isLight
              ? "border-[#C9A84C]/70 text-[#7A5A12] hover:bg-[#d4af37]/15"
              : "border-[#d4af37]/50 text-[#e8c86a] hover:bg-[#d4af37]/10"
          }`}
        >
          <X className="h-3.5 w-3.5" /> Close
        </button>
      </div>

      {/* The pad-nav root (see the header): the map body and
          the job rows, and not one focusable control — Back
          is the pad's only verb in here, so every other press
          is free to light its button. */}
      <div data-testid="world-controller-map">
        <svg
          viewBox={layout.viewBox}
          role="img"
          aria-label={`Controller map for ${profile.displayName}`}
          className="mx-auto mt-1 w-full max-w-[720px]"
        >
          <path d={layout.bodyPath} fill={palette.bodyFill} stroke={palette.bodyStroke} strokeWidth={2} />
          {nodes.map((node) => {
            const spot = layout.spots[node.id];
            if (!spot) return null;
            return (
              <NodeShape
                key={node.id}
                node={node}
                spot={spot}
                lit={lit.has(node.id)}
                palette={palette}
              />
            );
          })}
        </svg>

        <ul className="mx-auto mt-2 grid max-w-[980px] gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {nodes.map((node) => {
            const isLit = lit.has(node.id);
            const unused = node.job === NOT_USED_IN_WORLD;
            return (
              <li
                key={node.id}
                data-map-row={node.id}
                className={`rounded-lg px-2.5 py-1.5 text-xs transition ${
                  isLit
                    ? "bg-[#d4af37] text-black"
                    : isLight
                      ? "bg-[#d4af37]/8 text-[#2a1e07]"
                      : "bg-white/[0.04] text-white/85"
                }`}
              >
                <span className={`font-black ${isLit ? "text-black" : "text-[#d4af37]"}`}>
                  {node.glyph ? `${node.glyph} ` : ""}
                  {node.name}
                </span>{" "}
                <span className={unused && !isLit ? "opacity-55" : ""}>{node.job}</span>
                {node.pressJob ? <span> · press: {node.pressJob}</span> : null}
                {node.panelJob ? (
                  <span className={isLit ? "" : "opacity-60"}> · in a panel: {node.panelJob}</span>
                ) : null}
              </li>
            );
          })}
        </ul>

        <p
          className={`mx-auto mt-2 max-w-[980px] text-[11px] font-semibold ${
            isLight ? "text-[#6B5B36]" : "text-white/40"
          }`}
        >
          Buttons marked “{NOT_USED_IN_WORLD}” do nothing here — the World never reads them
          {profile.family === "playstation" && profile.displayName.includes("DualSense")
            ? ", and the mute button never reaches the browser at all"
            : ""}
          .
        </p>
      </div>
    </div>
  );
}
