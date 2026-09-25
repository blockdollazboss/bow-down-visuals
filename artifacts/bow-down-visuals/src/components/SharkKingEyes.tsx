import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shark King mascot with true eye-tracking.
 * The pupils follow the cursor; the head stays still.
 * Transparent background — the webp has the white removed.
 */
export function SharkKingEyes({ className = "" }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    // For each eye, calculate the vector from eye center to cursor
    // We'll use the container center as reference and clamp the pupil movement
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = (e.clientX - centerX) / (rect.width / 2);
    const dy = (e.clientY - centerY) / (rect.height / 2);

    // Clamp to [-1, 1] and scale to max pupil travel (about 12% of eye size)
    const x = Math.max(-1, Math.min(1, dx));
    const y = Math.max(-1, Math.min(1, dy));

    setPupilOffset({ x: x * 10, y: y * 8 });
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  // Eye positions as % of the image (measured from the 1600x1600 source)
  // Left eye center: ~31%, 50% | Right eye center: ~69%, 50%
  // Pupil cover + moving pupil are sized relative to the eye white
  const eyes = [
    { left: "31%", top: "50%" },
    { left: "69%", top: "50%" },
  ];

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`} aria-hidden>
      <img
        src="/shark-king-signin.webp"
        alt=""
        className="w-full h-full object-contain select-none pointer-events-none"
        draggable={false}
      />
      {/* Pupil overlays — cover the static pupils and move with the cursor */}
      {eyes.map((eye, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: eye.left,
            top: eye.top,
            width: "9%",
            height: "9%",
            transform: "translate(-50%, -50%)",
          }}
        >
          {/* Cover the baked-in pupil with eye-white */}
          <div className="absolute inset-0 rounded-full bg-[#e8eef4]" />
          {/* Moving pupil */}
          <div
            className="absolute rounded-full bg-[#0a0f1a]"
            style={{
              width: "62%",
              height: "62%",
              left: "19%",
              top: "19%",
              transform: `translate(${pupilOffset.x}%, ${pupilOffset.y}%)`,
              transition: "transform 0.08s ease-out",
            }}
          >
            {/* Catchlight */}
            <div className="absolute rounded-full bg-white" style={{ width: "28%", height: "28%", left: "18%", top: "14%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
