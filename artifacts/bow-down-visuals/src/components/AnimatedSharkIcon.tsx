/* Animated King Shark icon for Thy Cheat Code AI.
   Swimming motion: tail wag, body bob, rising bubbles.
   Gold/black luxury theme to match the brand. */

export function AnimatedSharkIcon({ className = "h-full w-full" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id="sharkGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5d67b" />
          <stop offset="50%" stopColor="#d4af37" />
          <stop offset="100%" stopColor="#9a7b1e" />
        </linearGradient>
        <linearGradient id="sharkBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a3a3a" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
      </defs>

      {/* Bubbles */}
      <g fill="#d4af37" opacity="0.6">
        <circle cx="78" cy="70" r="2.5">
          <animate attributeName="cy" values="70;30" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="r" values="2.5;4" dur="2.5s" repeatCount="indefinite" />
        </circle>
        <circle cx="85" cy="75" r="1.8">
          <animate attributeName="cy" values="75;35" dur="3.2s" begin="0.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0" dur="3.2s" begin="0.8s" repeatCount="indefinite" />
        </circle>
        <circle cx="72" cy="78" r="1.2">
          <animate attributeName="cy" values="78;40" dur="2s" begin="0.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0" dur="2s" begin="0.4s" repeatCount="indefinite" />
        </circle>
      </g>

      {/* Shark body group — bobs up and down */}
      <g>
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0; 0 -3; 0 0"
          dur="2s"
          repeatCount="indefinite"
        />
        {/* Body */}
        <ellipse cx="45" cy="55" rx="28" ry="16" fill="url(#sharkBody)" />
        {/* Belly */}
        <ellipse cx="45" cy="62" rx="20" ry="9" fill="#1a1a1a" opacity="0.8" />
        {/* Dorsal fin */}
        <path d="M40 40 L48 22 L54 40 Z" fill="url(#sharkGold)" />
        {/* Pectoral fin */}
        <path d="M35 62 L28 75 L40 68 Z" fill="#2a2a2a" />
        {/* Eye */}
        <circle cx="62" cy="50" r="3.5" fill="#fff" />
        <circle cx="63" cy="50" r="1.8" fill="#0a0a0a">
          <animate attributeName="r" values="1.8;1.2;1.8" dur="3s" repeatCount="indefinite" />
        </circle>
        {/* Gills */}
        <g stroke="#d4af37" strokeWidth="1.2" opacity="0.7">
          <line x1="52" y1="48" x2="52" y2="60" />
          <line x1="56" y1="48" x2="56" y2="60" />
        </g>
        {/* Teeth */}
        <g fill="#fff">
          <polygon points="58,60 60,64 62,60" />
          <polygon points="63,60 65,64 67,60" />
          <polygon points="68,60 70,64 72,60" />
        </g>
        {/* Crown */}
        <g>
          <polygon points="38,28 42,14 48,24 54,12 60,24 64,16 66,28" fill="url(#sharkGold)" />
          <circle cx="42" cy="14" r="2" fill="#f5d67b" />
          <circle cx="54" cy="12" r="2" fill="#f5d67b" />
          <circle cx="64" cy="16" r="2" fill="#f5d67b" />
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="-3 52 22; 3 52 22; -3 52 22"
            dur="2s"
            repeatCount="indefinite"
          />
        </g>
        {/* Tail — wags side to side */}
        <g>
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="-12 18 55; 12 18 55; -12 18 55"
            dur="0.8s"
            repeatCount="indefinite"
          />
          <polygon points="18,55 4,42 8,55 4,68" fill="url(#sharkGold)" />
        </g>
      </g>
    </svg>
  );
}
