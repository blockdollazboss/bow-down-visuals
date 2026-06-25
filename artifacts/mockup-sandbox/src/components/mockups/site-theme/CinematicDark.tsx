export function CinematicDark() {
  const GOLD = "#D4A843";
  const AMBER = "#F59E0B";
  const G = (o: number) => `rgba(212,168,67,${o})`;
  const P = (o: number) => `rgba(120,80,200,${o})`; // purple accent

  const features = [
    { icon: "🎵", label: "AI Song Writing", sub: "Hooks, verses, full tracks" },
    { icon: "🎬", label: "Music Video AI", sub: "Scene-by-scene video plans" },
    { icon: "🖼", label: "Thumbnails", sub: "Viral cover art, instantly" },
    { icon: "📢", label: "Promo Content", sub: "Captions, reels, campaigns" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #06030f 0%, #050408 40%, #040204 100%)",
      fontFamily: "system-ui, -apple-system, sans-serif",
      overflow: "hidden",
      position: "relative",
    }}>

      {/* Background depth layers */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `
          radial-gradient(ellipse 80% 60% at 70% 30%, ${P(0.08)} 0%, transparent 60%),
          radial-gradient(ellipse 60% 50% at 20% 80%, ${G(0.04)} 0%, transparent 60%)
        `,
      }} />

      {/* Subtle scanline texture */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.04,
        backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0px, transparent 1px, transparent 4px)",
        backgroundSize: "100% 5px",
      }} />

      {/* ── NAV ── */}
      <nav style={{
        position: "relative", zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 52px",
        height: 70,
        background: "rgba(5,3,10,0.6)",
        backdropFilter: "blur(20px)",
        borderBottom: `1px solid ${P(0.12)}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12,
            background: `linear-gradient(135deg, ${G(0.2)}, ${P(0.15)})`,
            border: `1px solid ${G(0.3)}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 0 20px ${G(0.15)}, 0 0 40px ${P(0.08)}`,
            fontSize: 18,
          }}>🦈</div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 900, color: "#fff", letterSpacing: "0.06em", lineHeight: 1 }}>
              BOW DOWN <span style={{ color: GOLD }}>VISUALS</span>
            </p>
            <p style={{ fontSize: 8.5, color: "rgba(255,255,255,0.25)", letterSpacing: "0.2em", marginTop: 2 }}>
              THE CONTENT CREATOR'S CHEAT CODE
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 28 }}>
          {["How It Works", "Tools", "Pricing", "Beta Access"].map((item, i) => (
            <span key={item} style={{
              fontSize: 13,
              color: i === 3 ? GOLD : "rgba(255,255,255,0.4)",
              fontWeight: i === 3 ? 800 : 500,
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}>{item}</span>
          ))}
        </div>

        <button style={{
          height: 40, padding: "0 24px", borderRadius: 12,
          background: `linear-gradient(135deg, ${G(0.2)}, ${G(0.1)})`,
          border: `1px solid ${G(0.4)}`,
          color: AMBER, fontWeight: 800, fontSize: 13,
          cursor: "pointer", letterSpacing: "0.04em",
          boxShadow: `0 0 16px ${G(0.15)}`,
        }}>Start Creating →</button>
      </nav>

      {/* ── HERO ── */}
      <div style={{
        position: "relative", zIndex: 5,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 52, paddingBottom: 56, textAlign: "center",
      }}>

        {/* Eyebrow */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          marginBottom: 32,
          background: `linear-gradient(90deg, ${P(0.12)}, ${G(0.08)})`,
          border: `1px solid ${P(0.25)}`,
          borderRadius: 100, padding: "7px 20px",
        }}>
          <span style={{
            fontSize: 16,
            filter: `drop-shadow(0 0 6px ${G(0.6)})`,
          }}>✦</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: GOLD, letterSpacing: "0.15em" }}>
            BETA ACCESS OPEN
          </span>
          <span style={{
            fontSize: 11, color: "rgba(255,255,255,0.25)", fontWeight: 500,
          }}>— Join thousands of creators</span>
        </div>

        {/* Mascot with cinematic rings */}
        <div style={{ position: "relative", marginBottom: 32 }}>
          {/* Outer aurora ring */}
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
            width: 360, height: 360, borderRadius: "50%",
            background: `conic-gradient(from 0deg, ${G(0.06)}, ${P(0.08)}, ${G(0.06)}, ${P(0.04)}, ${G(0.06)})`,
            filter: "blur(16px)",
            pointerEvents: "none",
          }} />
          {/* Middle ring */}
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
            width: 260, height: 260, borderRadius: "50%",
            border: `1px solid ${G(0.15)}`,
            pointerEvents: "none",
          }} />
          {/* Inner glow */}
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%,-50%)",
            width: 180, height: 180, borderRadius: "50%",
            background: `radial-gradient(circle, ${G(0.18)} 0%, transparent 70%)`,
            pointerEvents: "none",
            filter: "blur(8px)",
          }} />
          <div style={{
            fontSize: 130, position: "relative", zIndex: 2,
            filter: `drop-shadow(0 0 40px ${G(0.3)}) drop-shadow(0 0 80px ${P(0.2)})`,
          }}>🦈</div>
        </div>

        {/* Headline — editorial mix */}
        <h1 style={{
          maxWidth: 840, margin: "0 auto 18px",
          lineHeight: 1.06, letterSpacing: "-0.025em",
          fontSize: 60, fontWeight: 900,
        }}>
          <span style={{ color: "rgba(255,255,255,0.92)" }}>Create Songs, </span>
          <span style={{
            background: `linear-gradient(90deg, ${AMBER}, ${GOLD})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            filter: `drop-shadow(0 0 24px ${G(0.4)})`,
          }}>Music Videos</span>
          <br />
          <span style={{ color: "rgba(255,255,255,0.92)" }}>& Promo Content</span>
          <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 300 }}> — with AI</span>
        </h1>

        <p style={{
          fontSize: 16, maxWidth: 500, lineHeight: 1.75,
          color: "rgba(255,255,255,0.35)",
          margin: "0 auto 40px", fontWeight: 400,
        }}>
          The AI creative studio built for music artists.<br />
          From lyrics to launch — in minutes, not months.
        </p>

        {/* CTAs */}
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button style={{
            height: 54, padding: "0 36px", borderRadius: 16,
            background: `linear-gradient(135deg, #8B5E1A, ${AMBER}, ${GOLD})`,
            border: "none", color: "#000", fontWeight: 900, fontSize: 15,
            cursor: "pointer", letterSpacing: "0.03em",
            boxShadow: `0 0 40px ${G(0.4)}, 0 4px 24px rgba(0,0,0,0.5)`,
          }}>🎬 Start Creating Free</button>
          <button style={{
            height: 54, padding: "0 28px", borderRadius: 16,
            background: `${P(0.12)}`,
            border: `1px solid ${P(0.3)}`,
            color: "rgba(255,255,255,0.6)", fontWeight: 600, fontSize: 14,
            cursor: "pointer",
          }}>Watch Demo ▶</button>
        </div>

        {/* Feature row */}
        <div style={{
          display: "flex", gap: 10, marginTop: 56,
          maxWidth: 900, width: "100%", padding: "0 24px",
          flexWrap: "wrap", justifyContent: "center",
        }}>
          {features.map((f, i) => (
            <div key={f.label} style={{
              flex: "1 1 180px",
              display: "flex", alignItems: "center", gap: 12,
              background: `linear-gradient(135deg, ${i % 2 === 0 ? G(0.04) : P(0.04)}, rgba(255,255,255,0.02))`,
              border: `1px solid ${i % 2 === 0 ? G(0.15) : P(0.15)}`,
              borderRadius: 16, padding: "14px 16px",
              backdropFilter: "blur(10px)",
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: `${i % 2 === 0 ? G(0.1) : P(0.1)}`,
                border: `1px solid ${i % 2 === 0 ? G(0.2) : P(0.2)}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18,
              }}>{f.icon}</div>
              <div>
                <p style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", marginBottom: 2 }}>{f.label}</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{f.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
