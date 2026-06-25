import { useState } from "react";

const GOLD = "#C9A84C";
const GOLD_GLOW = "rgba(201,168,76,";

// Dashboard strip + video editor pill — compact versions

function DashboardStrip({ artist, compact }: { artist: { name: string; type: string; genre: string; initials: string; consistency: boolean; }; compact?: boolean }) {
  return (
    <div style={{
      borderRadius: compact ? 14 : 18,
      border: `1px solid ${GOLD_GLOW}0.28)`,
      background: `linear-gradient(90deg, ${GOLD_GLOW}0.06) 0%, rgba(0,0,0,0) 60%)`,
      padding: compact ? "8px 12px" : "12px 16px",
      display: "flex",
      alignItems: "center",
      gap: compact ? 10 : 14,
      position: "relative",
      overflow: "hidden",
      boxShadow: `0 0 24px ${GOLD_GLOW}0.06), inset 0 1px 0 ${GOLD_GLOW}0.1)`,
    }}>
      {/* Left gold accent line */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        width: 2.5,
        background: `linear-gradient(to bottom, ${GOLD}, ${GOLD_GLOW}0))`,
        borderRadius: "2px 0 0 2px",
      }} />

      {/* Avatar */}
      <div style={{
        width: compact ? 32 : 44,
        height: compact ? 32 : 44,
        borderRadius: compact ? 10 : 13,
        background: `linear-gradient(135deg, ${GOLD_GLOW}0.2) 0%, ${GOLD_GLOW}0.06) 100%)`,
        border: `1.5px solid ${GOLD_GLOW}0.4)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        boxShadow: `0 0 14px ${GOLD_GLOW}0.2)`,
        position: "relative",
      }}>
        <span style={{
          fontFamily: "Georgia, serif",
          fontSize: compact ? 12 : 16,
          fontWeight: 900,
          color: GOLD,
          letterSpacing: "0.04em",
        }}>{artist.initials}</span>

        {/* Pulse dot */}
        <div style={{
          position: "absolute",
          bottom: -1, right: -1,
          width: compact ? 7 : 9,
          height: compact ? 7 : 9,
          borderRadius: "50%",
          background: GOLD,
          border: "1.5px solid #060606",
          boxShadow: `0 0 6px ${GOLD}`,
        }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <p style={{ fontSize: compact ? 10.5 : 13, fontWeight: 900, color: "#fff", truncate: "true", letterSpacing: "0.02em" }}>
            {artist.name}
          </p>
          <span style={{
            fontSize: 7.5, fontWeight: 900,
            color: GOLD,
            background: `${GOLD_GLOW}0.1)`,
            border: `1px solid ${GOLD_GLOW}0.3)`,
            borderRadius: 4, padding: "1px 5px",
            letterSpacing: "0.12em",
            flexShrink: 0,
          }}>ACTIVE</span>
        </div>
        <p style={{
          fontSize: compact ? 9 : 10.5,
          color: "rgba(255,255,255,0.35)",
          marginTop: 2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {artist.type} · {artist.genre}
          {artist.consistency && !compact ? " · 🔒 Locked" : ""}
        </p>
      </div>

      {/* Right action */}
      {!compact && (
        <button style={{
          height: 30, borderRadius: 9,
          border: `1px solid ${GOLD_GLOW}0.3)`,
          background: `${GOLD_GLOW}0.08)`,
          color: GOLD,
          fontSize: 10.5, fontWeight: 800,
          cursor: "pointer",
          padding: "0 12px",
          flexShrink: 0,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}>Change →</button>
      )}
    </div>
  );
}

function EditorPill({ artist }: { artist: { name: string; genre: string; initials: string; consistency: boolean; } }) {
  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${GOLD_GLOW}0.3)`,
      background: `linear-gradient(90deg, ${GOLD_GLOW}0.07) 0%, rgba(0,0,0,0) 70%)`,
      padding: "7px 12px",
      display: "flex",
      alignItems: "center",
      gap: 9,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        width: 2,
        background: GOLD,
        borderRadius: "2px 0 0 2px",
      }} />

      <div style={{
        width: 26, height: 26, borderRadius: 8,
        background: `${GOLD_GLOW}0.18)`,
        border: `1.5px solid ${GOLD_GLOW}0.4)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        fontSize: 10, fontWeight: 900, color: GOLD,
        fontFamily: "Georgia, serif",
        boxShadow: `0 0 10px ${GOLD_GLOW}0.2)`,
      }}>{artist.initials}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: GOLD, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {artist.name}
        </p>
        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{artist.genre}</p>
      </div>

      {artist.consistency && (
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          fontSize: 9, fontWeight: 800,
          color: `${GOLD_GLOW}0.7)`,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 9 }}>🔒</span> Locked
        </div>
      )}
    </div>
  );
}

const DEMO_A = { name: "LIL PHANTOM", type: "Rapper", genre: "Trap · Drill", initials: "LP", consistency: true };
const DEMO_B = { name: "SOLEIL", type: "Singer", genre: "R&B · Soul", initials: "SO", consistency: false };

export function VariantB() {
  const [artist, setArtist] = useState(DEMO_A);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#060606",
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "32px 24px",
    }}>
      <div style={{ maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>

        {/* Section 1 — Dashboard strip */}
        <div>
          <Label text="Dashboard — Artist Strip" />
          <DashboardStrip artist={artist} />
        </div>

        {/* Section 2 — Video editor pill */}
        <div>
          <Label text="Video Editor — Artist Pill (above tabs)" />
          <EditorPill artist={artist} />
        </div>

        {/* Section 3 — Compact (mobile / tight spaces) */}
        <div>
          <Label text="Compact / Mobile strip" />
          <DashboardStrip artist={artist} compact />
        </div>

        {/* Divider */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 20 }}>
          <p style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.25)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
            Preview with different artist
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            {[DEMO_A, DEMO_B].map((a) => (
              <button key={a.name} onClick={() => setArtist(a)} style={{
                flex: 1, height: 34, borderRadius: 9,
                border: `1px solid ${artist.name === a.name ? GOLD_GLOW + "0.4)" : "rgba(255,255,255,0.08)"}`,
                background: artist.name === a.name ? `${GOLD_GLOW}0.08)` : "rgba(255,255,255,0.02)",
                color: artist.name === a.name ? GOLD : "rgba(255,255,255,0.3)",
                fontSize: 10.5, fontWeight: 800, cursor: "pointer", letterSpacing: "0.04em",
              }}>{a.name}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
      <div style={{ width: 2, height: 14, background: GOLD, borderRadius: 1 }} />
      <p style={{ fontSize: 9.5, fontWeight: 800, color: "rgba(255,255,255,0.3)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {text}
      </p>
    </div>
  );
}
