const GOLD = "#C9A84C";
const GOLD_GLOW = "rgba(201,168,76,";

const THEMES = [
  {
    id: "luxury-dark",
    name: "Luxury Dark",
    genre: "Hip Hop / Trap",
    bg: "linear-gradient(135deg, #0a0a0a 0%, #1a1200 100%)",
    textColor: "#C9A84C",
    accentColor: "#C9A84C",
    border: "rgba(201,168,76,0.35)",
    glow: "rgba(201,168,76,0.18)",
    preview: { artist: "ARTIST NAME", song: "Song Title", style: "serif" as const },
    tag: "CINEMATIC",
  },
  {
    id: "drill-street",
    name: "Drill Street",
    genre: "Drill / Street",
    bg: "linear-gradient(135deg, #0d0000 0%, #1a0000 100%)",
    textColor: "#ffffff",
    accentColor: "#ef4444",
    border: "rgba(239,68,68,0.4)",
    glow: "rgba(239,68,68,0.18)",
    preview: { artist: "ARTIST NAME", song: "SONG TITLE", style: "mono" as const },
    tag: "RAW",
  },
  {
    id: "rnb-smooth",
    name: "R&B Smooth",
    genre: "R&B / Soul",
    bg: "linear-gradient(135deg, #0d0010 0%, #1a0030 100%)",
    textColor: "#f9a8d4",
    accentColor: "#ec4899",
    border: "rgba(236,72,153,0.35)",
    glow: "rgba(236,72,153,0.18)",
    preview: { artist: "Artist Name", song: "Song Title", style: "italic" as const },
    tag: "SMOOTH",
  },
  {
    id: "club-neon",
    name: "Club Neon",
    genre: "Club / EDM",
    bg: "linear-gradient(135deg, #000d1a 0%, #001010 100%)",
    textColor: "#22d3ee",
    accentColor: "#e879f9",
    border: "rgba(34,211,238,0.4)",
    glow: "rgba(34,211,238,0.2)",
    preview: { artist: "ARTIST NAME", song: "SONG TITLE", style: "mono" as const },
    tag: "ELECTRIC",
  },
  {
    id: "kids-bright",
    name: "Kids Bright",
    genre: "Pop / Afrobeats",
    bg: "linear-gradient(135deg, #0a1500 0%, #000d20 100%)",
    textColor: "#facc15",
    accentColor: "#38bdf8",
    border: "rgba(250,204,21,0.4)",
    glow: "rgba(250,204,21,0.18)",
    preview: { artist: "Artist Name", song: "Song Title", style: "bold" as const },
    tag: "VIBRANT",
  },
  {
    id: "clean-minimal",
    name: "Clean Minimal",
    genre: "Alternative / Lo-fi",
    bg: "linear-gradient(135deg, #0a0a0a 0%, #111 100%)",
    textColor: "#ffffff",
    accentColor: "#ffffff",
    border: "rgba(255,255,255,0.2)",
    glow: "rgba(255,255,255,0.08)",
    preview: { artist: "Artist Name", song: "Song Title", style: "clean" as const },
    tag: "MINIMAL",
  },
];

function MiniCard({ theme, active }: { theme: typeof THEMES[0]; active: boolean }) {
  const artistFont =
    theme.preview.style === "serif"
      ? "Georgia, 'Times New Roman', serif"
      : theme.preview.style === "mono"
      ? "'Courier New', monospace"
      : theme.preview.style === "italic"
      ? "Georgia, serif"
      : "system-ui, sans-serif";

  return (
    <button
      style={{
        background: active ? theme.bg : "rgba(255,255,255,0.02)",
        border: `1.5px solid ${active ? theme.border : "rgba(255,255,255,0.07)"}`,
        borderRadius: 16,
        padding: 0,
        cursor: "pointer",
        transition: "all 0.22s ease",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: active ? `0 0 24px ${theme.glow}, 0 4px 24px rgba(0,0,0,0.5)` : "0 2px 8px rgba(0,0,0,0.3)",
        transform: active ? "scale(1.03)" : "scale(1)",
        position: "relative",
      }}
    >
      {/* Mini rendered card preview */}
      <div
        style={{
          background: theme.bg,
          padding: "18px 16px 14px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 4,
          borderBottom: `1px solid ${theme.border}`,
          minHeight: 90,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative line */}
        <div style={{ width: 28, height: 2, background: theme.accentColor, marginBottom: 6, borderRadius: 1 }} />

        <p
          style={{
            fontFamily: artistFont,
            fontSize: 13,
            fontWeight: theme.preview.style === "mono" ? 700 : 800,
            color: theme.textColor,
            letterSpacing: theme.preview.style === "mono" ? "0.1em" : "0.03em",
            fontStyle: theme.preview.style === "italic" ? "italic" : "normal",
            textTransform: theme.preview.style === "mono" ? "uppercase" : "none",
            lineHeight: 1.1,
            textShadow: active ? `0 0 16px ${theme.glow}` : "none",
          }}
        >
          {theme.preview.artist}
        </p>
        <p
          style={{
            fontFamily: artistFont,
            fontSize: 10,
            fontWeight: 400,
            color: theme.textColor,
            opacity: 0.65,
            fontStyle: theme.preview.style === "italic" ? "italic" : "normal",
            textTransform: theme.preview.style === "mono" ? "uppercase" : "none",
            letterSpacing: theme.preview.style === "mono" ? "0.12em" : "0.02em",
          }}
        >
          {theme.preview.song}
        </p>

        {/* Genre badge top-right */}
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            fontSize: 7,
            fontWeight: 900,
            letterSpacing: "0.12em",
            color: theme.accentColor,
            opacity: active ? 1 : 0.5,
            background: `${theme.glow}`,
            border: `1px solid ${theme.border}`,
            borderRadius: 4,
            padding: "2px 5px",
          }}
        >
          {theme.tag}
        </div>
      </div>

      {/* Label row */}
      <div style={{ padding: "10px 14px 12px", background: "rgba(0,0,0,0.6)" }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: active ? "#fff" : "rgba(255,255,255,0.55)", marginBottom: 2 }}>
          {theme.name}
        </p>
        <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>{theme.genre}</p>
      </div>

      {/* Active ring glow */}
      {active && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 16,
            border: `2px solid ${theme.accentColor}`,
            pointerEvents: "none",
          }}
        />
      )}
    </button>
  );
}

export function VariantA() {
  const [selected, setSelected] = useState("luxury-dark");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#080808",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "32px 24px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 680 }}>

        {/* Section header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 3, height: 22, background: `linear-gradient(to bottom, ${GOLD}, transparent)`, borderRadius: 2 }} />
            <p style={{ fontSize: 11, fontWeight: 900, color: GOLD, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              Artist Theme
            </p>
          </div>
          <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", lineHeight: 1.2, marginLeft: 13 }}>
            Choose Your Visual Identity
          </p>
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.35)", marginTop: 5, marginLeft: 13, lineHeight: 1.5 }}>
            Your intro &amp; outro cards inherit this style — pick the one that matches your sound.
          </p>
        </div>

        {/* Preview grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {THEMES.map((t) => (
            <MiniCard key={t.id} theme={t} active={selected === t.id} />
          ))}
        </div>

        {/* Selected preview bar */}
        {(() => {
          const t = THEMES.find((x) => x.id === selected)!;
          return (
            <div
              style={{
                marginTop: 16,
                borderRadius: 12,
                border: `1px solid ${t.border}`,
                background: t.bg,
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                boxShadow: `0 0 24px ${t.glow}`,
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: t.glow, border: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 12, height: 12, background: t.accentColor, borderRadius: 2 }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>{t.name} selected</p>
                <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.35)" }}>{t.genre} · Applied to intro &amp; outro cards</p>
              </div>
              <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", color: t.accentColor, background: t.glow, border: `1px solid ${t.border}`, borderRadius: 5, padding: "4px 8px" }}>
                ACTIVE
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Need useState — import it
import { useState } from "react";
