export function LuxuryNoir() {
  const GOLD = "#C9A84C";
  const GOLD2 = "#E8C96A";
  const G = (o: number) => `rgba(201,168,76,${o})`;

  const features = [
    { icon: "🎵", label: "AI Song Writing", sub: "Hooks, verses, full tracks" },
    { icon: "🎬", label: "Music Video AI", sub: "Scene-by-scene video plans" },
    { icon: "🖼", label: "Thumbnails", sub: "Viral cover art, instantly" },
    { icon: "📢", label: "Promo Content", sub: "Captions, reels, campaigns" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#050402",
      fontFamily: "system-ui, -apple-system, sans-serif",
      overflow: "hidden",
      position: "relative",
    }}>

      {/* Background texture — subtle gold grid */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: `
          linear-gradient(${G(0.04)} 1px, transparent 1px),
          linear-gradient(90deg, ${G(0.04)} 1px, transparent 1px)
        `,
        backgroundSize: "60px 60px",
        maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
      }} />

      {/* Hero glow — centered radial behind mascot */}
      <div style={{
        position: "absolute",
        top: "10%", left: "50%", transform: "translateX(-50%)",
        width: 700, height: 700,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${G(0.14)} 0%, ${G(0.05)} 35%, transparent 70%)`,
        pointerEvents: "none",
        filter: "blur(30px)",
      }} />

      {/* ── NAV ── */}
      <nav style={{
        position: "relative", zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 48px",
        height: 68,
        borderBottom: `1px solid ${G(0.12)}`,
        background: "rgba(5,4,2,0.85)",
        backdropFilter: "blur(12px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${G(0.25)}, ${G(0.06)})`,
            border: `1px solid ${G(0.35)}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 16px ${G(0.2)}`,
            fontSize: 16,
          }}>🦈</div>
          <span style={{ fontWeight: 900, fontSize: 15, color: "#fff", letterSpacing: "0.06em" }}>
            BOW DOWN <span style={{ color: GOLD }}>VISUALS</span>
          </span>
        </div>

        <div style={{ display: "flex", gap: 32 }}>
          {["How It Works", "Tools", "Pricing", "Beta Access"].map((item) => (
            <span key={item} style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", fontWeight: 600, cursor: "pointer", letterSpacing: "0.02em" }}>
              {item}
            </span>
          ))}
        </div>

        <button style={{
          height: 38, padding: "0 22px", borderRadius: 10,
          background: `linear-gradient(135deg, #B8922A, ${GOLD2})`,
          border: `1px solid ${G(0.5)}`,
          color: "#000", fontWeight: 900, fontSize: 13,
          cursor: "pointer", letterSpacing: "0.04em",
          boxShadow: `0 0 20px ${G(0.35)}, 0 2px 8px rgba(0,0,0,0.5)`,
        }}>Start Creating →</button>
      </nav>

      {/* ── HERO ── */}
      <div style={{
        position: "relative", zIndex: 5,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 48, paddingBottom: 60,
        textAlign: "center",
      }}>

        {/* Beta badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          background: `${G(0.08)}`,
          border: `1px solid ${G(0.3)}`,
          borderRadius: 100, padding: "6px 16px",
          marginBottom: 28,
          boxShadow: `0 0 20px ${G(0.1)}`,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD, boxShadow: `0 0 8px ${GOLD}` }} />
          <span style={{ fontSize: 11, fontWeight: 800, color: GOLD, letterSpacing: "0.12em" }}>BETA ACCESS OPEN</span>
        </div>

        {/* Mascot — with layered glow rings */}
        <div style={{ position: "relative", marginBottom: 24 }}>
          {[300, 220, 160].map((size, i) => (
            <div key={size} style={{
              position: "absolute",
              top: "50%", left: "50%",
              transform: "translate(-50%,-50%)",
              width: size, height: size, borderRadius: "50%",
              border: `1px solid ${G(0.06 - i * 0.015)}`,
              pointerEvents: "none",
            }} />
          ))}
          <div style={{
            width: 240, height: 240,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${G(0.12)} 0%, transparent 70%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 120, filter: "drop-shadow(0 0 30px rgba(201,168,76,0.3))",
          }}>🦈</div>
        </div>

        {/* Headline */}
        <h1 style={{
          fontSize: 64, fontWeight: 900, lineHeight: 1.05,
          margin: "0 0 16px",
          letterSpacing: "-0.02em",
          maxWidth: 780,
        }}>
          <span style={{ color: "#fff" }}>Create Songs, </span>
          <span style={{
            color: GOLD2,
            textShadow: `0 0 40px ${G(0.5)}`,
          }}>Music Videos</span>
          <br />
          <span style={{ color: "#fff" }}>& Promo Content</span>
        </h1>

        <p style={{
          fontSize: 16, color: "rgba(255,255,255,0.4)",
          maxWidth: 520, lineHeight: 1.7,
          margin: "0 0 36px",
          fontWeight: 400,
        }}>
          The AI creative studio built for music artists. From lyrics to launch — in minutes, not months.
        </p>

        {/* CTA pair */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button style={{
            height: 52, padding: "0 32px", borderRadius: 14,
            background: `linear-gradient(135deg, #A07820, ${GOLD2}, #B8922A)`,
            border: "none", color: "#000", fontWeight: 900, fontSize: 15,
            cursor: "pointer", letterSpacing: "0.04em",
            boxShadow: `0 0 32px ${G(0.45)}, 0 4px 16px rgba(0,0,0,0.4)`,
          }}>🎬 Start Creating Free</button>
          <button style={{
            height: 52, padding: "0 28px", borderRadius: 14,
            background: "transparent",
            border: `1px solid ${G(0.3)}`,
            color: GOLD, fontWeight: 700, fontSize: 14,
            cursor: "pointer",
          }}>Watch Demo</button>
        </div>

        {/* Feature pills */}
        <div style={{
          display: "flex", gap: 12, marginTop: 56, flexWrap: "wrap", justifyContent: "center",
          maxWidth: 860, padding: "0 24px",
        }}>
          {features.map((f) => (
            <div key={f.label} style={{
              display: "flex", alignItems: "center", gap: 10,
              background: `${G(0.05)}`,
              border: `1px solid ${G(0.18)}`,
              borderRadius: 14, padding: "12px 18px",
              flex: "1 1 180px",
              backdropFilter: "blur(8px)",
            }}>
              <span style={{ fontSize: 22 }}>{f.icon}</span>
              <div>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#fff", marginBottom: 2 }}>{f.label}</p>
                <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)" }}>{f.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
