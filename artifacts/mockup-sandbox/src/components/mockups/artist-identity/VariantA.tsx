import { useState } from "react";

const GOLD = "#C9A84C";
const GOLD_GLOW = "rgba(201,168,76,";

// Simulated artist data
const ARTIST = {
  name: "LIL PHANTOM",
  type: "Rapper",
  genre: "Trap · Drill",
  style: "Dark, cinematic, aggressive",
  colors: "Black & Gold",
  consistency: true,
  imageUrl: null as string | null,
  initials: "LP",
};

// Simulated "no image" artist
const ARTIST_NO_IMG = {
  name: "SOLEIL",
  type: "Singer",
  genre: "R&B · Soul",
  style: "Smooth, romantic",
  colors: "Rose & Purple",
  consistency: false,
  imageUrl: null as string | null,
  initials: "SO",
};

function ArtistCard({ artist, active, onClick }: {
  artist: typeof ARTIST;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div style={{
      borderRadius: 24,
      overflow: "hidden",
      border: `1.5px solid ${GOLD_GLOW}${active ? "0.4" : "0.15"})`,
      background: "#0a0800",
      boxShadow: active
        ? `0 0 60px ${GOLD_GLOW}0.12), 0 8px 40px rgba(0,0,0,0.7)`
        : "0 4px 20px rgba(0,0,0,0.5)",
      transition: "all 0.3s ease",
      cursor: "pointer",
      position: "relative",
    }} onClick={onClick}>

      {/* Top band — artist photo or initials */}
      <div style={{
        height: 180,
        background: artist.imageUrl
          ? `url(${artist.imageUrl}) center/cover no-repeat`
          : `linear-gradient(135deg, #1a1200 0%, #0d0800 60%, #000 100%)`,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        {/* Gradient overlay */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(10,8,0,0.85) 100%)",
        }} />

        {/* Ambient glow orbs */}
        <div style={{
          position: "absolute", top: "20%", left: "30%",
          width: 200, height: 200,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD_GLOW}0.1) 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />

        {!artist.imageUrl && (
          <div style={{
            position: "relative",
            width: 72, height: 72,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${GOLD_GLOW}0.25) 0%, ${GOLD_GLOW}0.06) 100%)`,
            border: `2px solid ${GOLD_GLOW}0.4)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 24px ${GOLD_GLOW}0.25)`,
          }}>
            <span style={{
              fontFamily: "Georgia, serif",
              fontSize: 22, fontWeight: 900,
              color: GOLD,
              letterSpacing: "0.05em",
            }}>{artist.initials}</span>
          </div>
        )}

        {/* Top-left gold accent bar */}
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: 3,
          background: `linear-gradient(to bottom, ${GOLD}, ${GOLD_GLOW}0) 100%)`,
        }} />

        {/* ACTIVE badge top-right */}
        {active && (
          <div style={{
            position: "absolute", top: 14, right: 14,
            display: "flex", alignItems: "center", gap: 5,
            background: `${GOLD_GLOW}0.15)`,
            border: `1px solid ${GOLD_GLOW}0.4)`,
            borderRadius: 8, padding: "4px 10px",
            backdropFilter: "blur(8px)",
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: GOLD, boxShadow: `0 0 6px ${GOLD}` }} />
            <span style={{ fontSize: 9, fontWeight: 900, color: GOLD, letterSpacing: "0.14em" }}>ACTIVE</span>
          </div>
        )}

        {/* Name overlaid on bottom of image band */}
        <div style={{ position: "absolute", bottom: 14, left: 20, right: 20 }}>
          <p style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: 24, fontWeight: 900,
            color: "#fff",
            letterSpacing: "0.05em",
            textShadow: "0 2px 12px rgba(0,0,0,0.9)",
            lineHeight: 1.1,
          }}>{artist.name}</p>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 3, letterSpacing: "0.04em" }}>
            {artist.type}
          </p>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "16px 20px 20px" }}>
        {/* Trait pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {[artist.genre, artist.style, artist.colors].filter(Boolean).map((trait, i) => (
            <span key={i} style={{
              fontSize: 10, fontWeight: 700,
              color: i === 0 ? GOLD : "rgba(255,255,255,0.45)",
              background: i === 0 ? `${GOLD_GLOW}0.08)` : "rgba(255,255,255,0.04)",
              border: `1px solid ${i === 0 ? GOLD_GLOW + "0.25)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 6, padding: "3px 8px",
            }}>{trait}</span>
          ))}
        </div>

        {/* Consistency lock */}
        {artist.consistency && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: `${GOLD_GLOW}0.05)`,
            border: `1px solid ${GOLD_GLOW}0.18)`,
            borderRadius: 10, padding: "8px 12px",
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 12 }}>🔒</span>
            <div>
              <p style={{ fontSize: 10, fontWeight: 800, color: GOLD, letterSpacing: "0.08em" }}>CONSISTENCY LOCK ACTIVE</p>
              <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>Every AI prompt uses this artist's style rules</p>
            </div>
          </div>
        )}

        {/* Primary CTA */}
        <button style={{
          width: "100%",
          height: 48,
          borderRadius: 14,
          border: `1.5px solid ${GOLD_GLOW}0.5)`,
          background: `linear-gradient(135deg, ${GOLD_GLOW}0.18) 0%, ${GOLD_GLOW}0.08) 100%)`,
          color: GOLD,
          fontSize: 13, fontWeight: 900,
          letterSpacing: "0.05em",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          boxShadow: `0 0 20px ${GOLD_GLOW}0.15), inset 0 1px 0 ${GOLD_GLOW}0.2)`,
          marginBottom: 10,
          transition: "all 0.2s",
        }}>
          <span style={{ fontSize: 15 }}>▶</span>
          Continue with {artist.name}
        </button>

        {/* Secondary actions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {["Change Artist", "Edit Details"].map((label) => (
            <button key={label} style={{
              height: 36, borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
              color: "rgba(255,255,255,0.45)",
              fontSize: 11, fontWeight: 700,
              cursor: "pointer",
            }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function VariantA() {
  const [selected, setSelected] = useState(0);
  const artists = [ARTIST, ARTIST_NO_IMG];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#060606",
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "32px 24px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        {/* Section label */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <div style={{ width: 2, height: 18, background: GOLD, borderRadius: 1 }} />
          <p style={{ fontSize: 10, fontWeight: 900, color: GOLD, letterSpacing: "0.2em", textTransform: "uppercase" }}>
            Active Artist · Workflow Banner
          </p>
        </div>

        <ArtistCard artist={artists[selected]!} active={true} onClick={() => {}} />

        {/* Toggle between states */}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {artists.map((a, i) => (
            <button key={i} onClick={() => setSelected(i)} style={{
              flex: 1, height: 34, borderRadius: 10,
              border: `1px solid ${selected === i ? GOLD_GLOW + "0.4)" : "rgba(255,255,255,0.08)"}`,
              background: selected === i ? `${GOLD_GLOW}0.08)` : "rgba(255,255,255,0.02)",
              color: selected === i ? GOLD : "rgba(255,255,255,0.35)",
              fontSize: 10.5, fontWeight: 800, cursor: "pointer",
              letterSpacing: "0.04em",
            }}>
              {a.name}
            </button>
          ))}
        </div>
        <p style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 8 }}>
          Toggle to preview different artists
        </p>
      </div>
    </div>
  );
}
