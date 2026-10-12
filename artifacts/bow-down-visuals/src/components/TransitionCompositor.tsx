/**
 * TransitionCompositor — overlays the outgoing video and animates scene transitions.
 *
 * The outgoing <video> element is ALWAYS in the DOM (visibility: hidden when idle)
 * so that TimelinePreviewPlayer can set outgoingVideoRef.current.src at any time,
 * even before a transition is triggered.
 */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface TransitionState {
  type: string;
  duration: number;
}

interface TransitionCompositorProps {
  outgoingVideoRef: RefObject<HTMLVideoElement | null>;
  transitionState: TransitionState | null;
}

type Phase = "idle" | "start" | "animating";

export function TransitionCompositor({ outgoingVideoRef, transitionState }: TransitionCompositorProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [flashOpacity, setFlashOpacity] = useState(0);
  const [blackOpacity, setBlackOpacity] = useState(0);
  const rafRef = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (flashTimer.current)  clearTimeout(flashTimer.current);
    if (blackTimer.current)  clearTimeout(blackTimer.current);

    if (!transitionState || transitionState.type === "Cut") {
      setPhase("idle");
      setFlashOpacity(0);
      setBlackOpacity(0);
      return;
    }

    setPhase("start");

    rafRef.current = requestAnimationFrame(() => {
      setPhase("animating");

      const { type, duration } = transitionState;

      if (type === "Flash") {
        setFlashOpacity(1);
        flashTimer.current = setTimeout(() => setFlashOpacity(0), 220);
      } else if (type === "Light Leak") {
        setFlashOpacity(1);
        flashTimer.current = setTimeout(() => setFlashOpacity(0), Math.round(duration * 600));
      } else if (type === "Fade to Black") {
        setBlackOpacity(1);
        blackTimer.current = setTimeout(() => setBlackOpacity(0), Math.round(duration * 500));
      }
    });

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (flashTimer.current)  clearTimeout(flashTimer.current);
      if (blackTimer.current)  clearTimeout(blackTimer.current);
    };
  }, [transitionState]);

  const type = transitionState?.type ?? "Cut";
  const dur  = transitionState?.duration ?? 0.5;
  const isAnimating = phase === "animating";
  const isActive    = phase !== "idle";

  const baseVideoStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    pointerEvents: "none",
    zIndex: 5,
    visibility: isActive ? "visible" : "hidden",
    transition: "none",
  };

  if (isActive) {
    const durCss = `${dur.toFixed(2)}s`;

    switch (type) {
      case "Crossfade":
      case "Fade to Black":
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.transition = `opacity ${durCss} ease`;
        break;

      case "Slide":
      case "Whip Pan":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.transform = isAnimating ? "translateX(-100%)" : "translateX(0)";
        baseVideoStyle.transition = `transform ${durCss} cubic-bezier(0.7,0,0.3,1)`;
        break;

      case "Zoom":
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.transform = isAnimating ? "scale(1.18)" : "scale(1)";
        baseVideoStyle.transition = `opacity ${durCss} ease, transform ${durCss} ease`;
        break;

      case "Blur Dissolve":
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.filter = isAnimating ? "blur(16px)" : "blur(0px)";
        baseVideoStyle.transition = `opacity ${durCss} ease, filter ${durCss} ease`;
        break;

      case "Glitch":
        // Stepped keyframe glitch (slice jumps + chromatic aberration) that
        // ends with the outgoing scene gone — mirrors the export's custom
        // glitch transition. The animation only runs once "animating" starts.
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-glitch-slice ${durCss} linear forwards` : "none";
        break;

      case "Spin":
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.transform = isAnimating ? "scale(0.1) rotate(360deg)" : "scale(1) rotate(0deg)";
        baseVideoStyle.transition = `opacity ${durCss} ease, transform ${durCss} cubic-bezier(0.4,0,0.2,1)`;
        break;

      case "Flash":
      case "Light Leak":
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.transition = `opacity ${Math.max(0.05, dur - 0.22).toFixed(2)}s ease 0.22s`;
        break;

      case "Zoom Blur":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-zoom-blur ${durCss} ease-in forwards` : "none";
        break;

      case "RGB Split":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-rgb-split ${durCss} linear forwards` : "none";
        break;

      case "Morph":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-morph ${durCss} ease-in-out forwards` : "none";
        break;

      case "Page Peel":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-page-peel ${durCss} ease-in forwards` : "none";
        break;

      case "Cube Rotate":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-cube-rotate ${durCss} ease-in forwards` : "none";
        break;

      case "Ripple":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-ripple ${durCss} ease-out forwards` : "none";
        break;

      case "Shatter":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-shatter ${durCss} linear forwards` : "none";
        break;

      case "Iris In":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-iris-in ${durCss} ease-in forwards` : "none";
        break;

      case "Iris Out":
        // The incoming scene irises open over the outgoing — the outgoing
        // zooms slightly and fades while the new scene takes over.
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.transform = isAnimating ? "scale(1.12)" : "scale(1)";
        baseVideoStyle.transition = `opacity ${durCss} ease, transform ${durCss} ease`;
        break;

      case "Cross Zoom":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-cross-zoom ${durCss} ease-in forwards` : "none";
        break;

      case "Slide Mosaic":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-slide-mosaic ${durCss} linear forwards` : "none";
        break;

      case "Chromatic Aberration":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-chromatic ${durCss} linear forwards` : "none";
        break;

      case "Lens Distortion":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-lens-distort ${durCss} ease-in forwards` : "none";
        break;

      case "Water Drop":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-water-drop ${durCss} ease-out forwards` : "none";
        break;

      case "Pixelize":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-pixelize ${durCss} steps(6) forwards` : "none";
        break;

      case "Circle Close":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-circle-close ${durCss} ease-in forwards` : "none";
        break;

      case "Radial Wipe":
        baseVideoStyle.opacity = 1;
        baseVideoStyle.animation = isAnimating ? `bdv-radial-wipe ${durCss} linear forwards` : "none";
        break;

      case "Film Burn":
        // The burn overlay carries the effect; the outgoing fades underneath.
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.transition = `opacity ${(dur * 0.6).toFixed(2)}s ease`;
        break;

      case "Paint Splash":
        // The splash blob overlay carries the effect; the outgoing fades under it.
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.transition = `opacity ${durCss} ease`;
        break;

      case "Circle Open":
        // The incoming scene irises open over the outgoing — the outgoing
        // fades while the ring overlay sweeps outward.
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.transition = `opacity ${durCss} ease`;
        break;

      default:
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.transition = `opacity ${durCss} ease`;
    }
  }

  return (
    <>
      <video
        ref={outgoingVideoRef as RefObject<HTMLVideoElement>}
        playsInline
        muted
        style={baseVideoStyle}
        data-testid="transition-outgoing-video"
      />

      {isActive && (type === "Flash" || type === "Light Leak") && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 6,
            opacity: flashOpacity,
            transition: "opacity 0.2s ease",
            background:
              type === "Light Leak"
                ? "linear-gradient(135deg, rgba(255,200,60,0.85) 0%, rgba(255,100,0,0.5) 50%, transparent 80%)"
                : "rgba(255,255,255,1)",
          }}
        />
      )}

      {isActive && type === "Fade to Black" && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 6,
            background: "#000",
            opacity: blackOpacity,
            transition: `opacity ${(dur * 0.5).toFixed(2)}s ease`,
          }}
        />
      )}

      {isAnimating && type === "Film Burn" && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 6,
            mixBlendMode: "screen",
            background:
              "radial-gradient(ellipse 90% 70% at 80% 20%, rgba(255,240,180,0.95) 0%, rgba(255,160,40,0.75) 35%, rgba(255,80,0,0.45) 60%, transparent 80%)," +
              "radial-gradient(ellipse 70% 60% at 15% 85%, rgba(255,120,20,0.6) 0%, transparent 70%)",
            animation: `bdv-film-burn ${dur.toFixed(2)}s ease forwards`,
            opacity: 0,
          }}
        />
      )}

      {isAnimating && type === "Ripple" && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 6 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: "46vmin",
                height: "46vmin",
                borderRadius: "50%",
                border: "3px solid rgba(180,220,255,0.85)",
                animation: `bdv-ripple-ring ${dur.toFixed(2)}s ease-out ${(i * dur * 0.22).toFixed(2)}s forwards`,
                opacity: 0,
              }}
            />
          ))}
        </div>
      )}

      {isAnimating && type === "Water Drop" && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 6 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: "52vmin",
                height: "52vmin",
                borderRadius: "50%",
                border: "4px solid rgba(140,200,255,0.9)",
                animation: `bdv-water-ring ${dur.toFixed(2)}s ease-out ${(i * dur * 0.2).toFixed(2)}s forwards`,
                opacity: 0,
              }}
            />
          ))}
        </div>
      )}

      {isAnimating && type === "Paint Splash" && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 6 }}>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "150vmin",
              height: "150vmin",
              borderRadius: "48% 52% 55% 45% / 50% 46% 54% 50%",
              background:
                "radial-gradient(circle at 30% 30%, rgba(255,200,60,0.95) 0 12%, transparent 13%)," +
                "radial-gradient(circle at 65% 25%, rgba(255,90,40,0.9) 0 9%, transparent 10%)," +
                "radial-gradient(circle at 75% 60%, rgba(40,200,220,0.9) 0 11%, transparent 12%)," +
                "radial-gradient(circle at 40% 70%, rgba(255,60,120,0.9) 0 10%, transparent 11%)," +
                "radial-gradient(circle at 55% 50%, rgba(20,20,30,0.95) 0 34%, transparent 35%)",
              animation: `bdv-paint-splash ${dur.toFixed(2)}s ease-out forwards`,
              opacity: 0,
            }}
          />
        </div>
      )}

      {isAnimating && type === "Pixelize" && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 6,
            background: "repeating-conic-gradient(rgba(8,8,12,0.6) 0% 25%, transparent 0% 50%)",
            animation: `bdv-pixel-blocks ${dur.toFixed(2)}s linear forwards`,
            opacity: 0,
          }}
        />
      )}

      {isAnimating && type === "Circle Open" && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 6 }}>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "70vmin",
              height: "70vmin",
              borderRadius: "50%",
              border: "5px solid rgba(255,215,120,0.95)",
              boxShadow: "0 0 24px rgba(255,190,60,0.55)",
              animation: `bdv-ring-expand ${dur.toFixed(2)}s ease-out forwards`,
              opacity: 0,
            }}
          />
        </div>
      )}

      {isAnimating && type === "Circle Close" && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 6 }}>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "70vmin",
              height: "70vmin",
              borderRadius: "50%",
              border: "5px solid rgba(255,215,120,0.95)",
              boxShadow: "0 0 24px rgba(255,190,60,0.55)",
              animation: `bdv-ring-shrink ${dur.toFixed(2)}s ease-in forwards`,
              opacity: 0,
            }}
          />
        </div>
      )}
    </>
  );
}
