import { useState } from "react";

const THEMES = [
  {
    id: "luxury-dark",
    name: "Luxury Dark",
    genre: "Hip Hop · Trap",
    bg: "radial-gradient(ellipse at 60% 30%, #2a1800 0%, #0a0800 60%, #000 100%)",
    cardBg: "linear-gradient(135deg, #1a1000 0%, #0a0600 100%)",
    primary: "#C9A84C",
    secondary: "#8B6914",
    glow: "rgba(201,168,76,",
    particles: ["✦", "◆", "✧"],
    artWord: "LUXE",
    fontStyle: { fontFamily: "Georgia, 'Times New Roman', serif", letterSpacing: "0.06em" },
  },
  {
    id: "drill-street",
    name: "Drill Street",
    genre: "Drill · Street",
    bg: "radial-gradient(ellipse at 40% 20%, #1a0000 0%, #080000 60%, #000 100%)",
    cardBg: "linear-gradient(135deg, #140000 0%, #0a0000 100%)",
    primary: "#ef4444",
    secondary: "#7f1d1d",
    glow: "rgba(239,68,68,",
    particles: ["■", "▲", "◼"],
    artWord: "RAW",
    fontStyle: { fontFamily: "'Courier New', monospace", letterSpacing: "0.14em", textTransform: "uppercase" as const },
  },
  {
    id: "rnb-smooth",
    name: "R&B Smooth",
    genre: "R&B · Soul",
    bg: "radial-gradient(ellipse at 50% 40%, #1e0030 0%, #0a0015 60%, #000 100%)",
    cardBg: "linear-gradient(135deg, #180025 0%, #0a0015 100%)",
    primary: "#e879f9",
    secondary: "#86198f",
    glow: "rgba(232,121,249,",
    particles: ["♪", "✿", "◈"],
    artWord: "SOUL",
    fontStyle: { fontFamily: "Georgia, serif", letterSpacing: "0.04em", fontStyle: "italic" as const },
  },
  {
    id: "club-neon",
    name: "Club Neon",
    genre: "Club · EDM",
    bg: "radial-gradient(ellipse at 30% 50%, #001a1a 0%, #000d10 60%, #000 100%)",
    cardBg: "linear-gradient(135deg, #001515 0%, #000a10 100%)",
    primary: "#22d3ee",
    secondary: "#e879f9",
    glow: "rgba(34,211,238,",
    particles: ["◉", "▸", "⬡"],
    artWord: "NEON",
    fontStyle: { fontFamily: "'Courier New', monospace", letterSpacing: "0.18em", textTransform: "uppercase" as const },
  },
  {
    id: "kids-bright",
    name: "Kids Bright",
    genre: "Pop · Afrobeats",
    bg: "radial-gradient(ellipse at 70% 30%, #1a1500 0%, #000d1a 60%, #000 100%)",
    cardBg: "linear-gradient(135deg, #141000 0%, #000a15 100%)",
    primary: "#facc15",
    secondary: "#38bdf8",
    glow: "rgba(250,204,21,",
    particles: ["★", "◆", "●"],
    artWord: "POP",
    fontStyle: { fontFamily: "system-ui, sans-serif", letterSpacing: "0.02em", fontWeight: 900 },
  },
  {
    id: "clean-minimal",
    name: "Clean Minimal",
    genre: "Alt · Lo-fi",
    bg: "radial-gradient(ellipse at 50% 50%, #141414 0%, #080808 100%)",
    cardBg: "linear-gradient(135deg, #111 0%, #0a0a0a 100%)",
    primary: "#ffffff",
    secondary: "#666",
    glow: "rgba(255,255,255,",
    particles: ["—", "·", "○"],
    artWord: "PURE",
    fontStyle: { fontFamily: "system-ui, sans-serif", letterSpacing: "0.08em" },
  },
];

function ThemeCard({ theme, active, onClick }: { theme: typeof THEMES[0]; active: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const lit = active || hovered;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        borderRadius: 20,
        overflow: "hidden",
        border: `1.5px solid ${lit ? theme.primary + "55" : "rgba(255,255,255,0.06)"}`,
        cursor: "pointer",
        transition: "all 0.28s cubic-bezier(0.34,1.56,0.64,1)",
        transform: active ? "scale(1.04)" : hovered ? "scale(1.02)" : "scale(1)",
        boxShadow: active
          ? `0 0 32px ${theme.glow}0.22), 0 8px 32px rgba(0,0,0,0.6)`
          : hovered
          ? `0 0 16px ${theme.glow}0.12), 0 4px 16px rgba(0,0,0,0.4)`
          : "0 2px 8px rgba(0,0,0,0.3)",
        background: lit ? theme.cardBg : "#0d0d0d",
        aspectRatio: "3/4",
        display: "flex",
        flexDirection: "column",
        padding: 0,
        textAlign: "left",
      }}
    >
      {/* Top section — art word + particles */}
      <div
        style={{
          flex: 1,
          background: lit ? theme.bg : "transparent",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          padding: "18px 16px 12px",
          position: "relative",
          overflow: "hidden",
          transition: "background 0.3s",
        }}
      >
        {/* Big art word watermark */}
        <p
          style={{
            position: "absolute",
            top: 8,
            right: 6,
            fontSize: 38,
            fontWeight: 900,
            color: theme.primary,
            opacity: lit ? 0.08 : 0.04,
            lineHeight: 1,
            letterSpacing: "0.02em",
            pointerEvents: "none",
            transition: "opacity 0.3s",
            ...theme.fontStyle,
          }}
        >
          {theme.artWord}
        </p>

        {/* Particles */}
        <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 5, opacity: lit ? 0.5 : 0.15, transition: "opacity 0.3s" }}>
          {theme.particles.map((p, i) => (
            <span key={i} style={{ fontSize: 7, color: theme.primary, fontWeight: 900 }}>{p}</span>
          ))}
        </div>

        {/* Glow orb */}
        {lit && (
          <div
            style={{
              position: "absolute",
              top: "30%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${theme.glow}0.18) 0%, transparent 70%)`,
              pointerEvents: "none",
            }}
          />
        )}

        {/* Genre pill */}
        <div
          style={{
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: theme.primary,
            background: `${theme.glow}0.12)`,
            border: `1px solid ${theme.glow}0.3)`,
            borderRadius: 6,
            padding: "3px 8px",
            marginBottom: 8,
            opacity: lit ? 1 : 0.4,
            transition: "opacity 0.25s",
          }}
        >
          {theme.genre}
        </div>

        {/* Title text preview */}
        <p
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: theme.primary,
            lineHeight: 1.1,
            opacity: lit ? 1 : 0.5,
            textShadow: lit ? `0 0 20px ${theme.glow}0.6)` : "none",
            transition: "all 0.25s",
            ...theme.fontStyle,
          }}
        >
          ARTIST NAME
        </p>
      </div>

      {/* Bottom label */}
      <div
        style={{
          padding: "10px 14px",
          background: "rgba(0,0,0,0.75)",
          borderTop: `1px solid ${lit ? theme.primary + "22" : "rgba(255,255,255,0.04)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          transition: "border-color 0.25s",
        }}
      >
        <p style={{ fontSize: 11, fontWeight: 800, color: active ? "#fff" : "rgba(255,255,255,0.5)", transition: "color 0.2s" }}>
          {theme.name}
        </p>
        {active && (
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: theme.primary,
              boxShadow: `0 0 8px ${theme.glow}0.8)`,
            }}
          />
        )}
      </div>

      {/* Active border overlay */}
      {active && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 20,
            border: `2px solid ${theme.primary}`,
            pointerEvents: "none",
            opacity: 0.6,
          }}
        />
      )}
    </button>
  );
}

export function VariantB() {
  const [selected, setSelected] = useState("luxury-dark");
  const active = THEMES.find((t) => t.id === selected)!;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#060606",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "32px 24px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 680 }}>

        {/* Header */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: `linear-gradient(135deg, ${active.primary}33, transparent)`,
                border: `1px solid ${active.primary}44`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.3s",
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: 3, background: active.primary, transition: "background 0.3s" }} />
            </div>
            <p style={{ fontSize: 10.5, fontWeight: 900, color: active.primary, letterSpacing: "0.16em", textTransform: "uppercase", transition: "color 0.3s" }}>
              Artist Theme
            </p>
          </div>
          <p style={{ fontSize: 21, fontWeight: 800, color: "#fff", lineHeight: 1.2, marginBottom: 5 }}>
            Your Visual Identity
          </p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
            Sets the mood for your intro card, outro card, and title overlays.
          </p>
        </div>

        {/* Theme grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
          {THEMES.map((t) => (
            <ThemeCard key={t.id} theme={t} active={selected === t.id} onClick={() => setSelected(t.id)} />
          ))}
        </div>

        {/* Active theme status strip */}
        <div
          style={{
            borderRadius: 14,
            border: `1px solid ${active.primary}33`,
            background: `linear-gradient(90deg, ${active.glow}0.08) 0%, transparent 60%)`,
            padding: "13px 18px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            transition: "all 0.35s",
            boxShadow: `inset 0 0 40px ${active.glow}0.06)`,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `${active.glow}0.15)`,
              border: `1px solid ${active.primary}33`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: 14,
              color: active.primary,
              fontWeight: 900,
              transition: "all 0.3s",
            }}
          >
            {active.particles[0]}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>
              {active.name}
              <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: active.primary, background: `${active.glow}0.12)`, border: `1px solid ${active.primary}33`, borderRadius: 4, padding: "2px 6px", verticalAlign: "middle", letterSpacing: "0.1em" }}>
                ACTIVE
              </span>
            </p>
            <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
              {active.genre} · Applied to all branded cards
            </p>
          </div>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: active.primary,
              boxShadow: `0 0 12px ${active.glow}0.9)`,
              animation: "none",
              transition: "all 0.3s",
            }}
          />
        </div>
      </div>
    </div>
  );
}
