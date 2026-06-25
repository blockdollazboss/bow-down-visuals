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
        baseVideoStyle.opacity = isAnimating ? 0 : 1;
        baseVideoStyle.filter = isAnimating ? "hue-rotate(90deg) saturate(4) blur(2px)" : "none";
        baseVideoStyle.transition = `opacity ${durCss} ease, filter ${durCss} ease`;
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
    </>
  );
}
