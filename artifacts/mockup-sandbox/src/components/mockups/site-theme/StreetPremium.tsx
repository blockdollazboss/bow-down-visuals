export function StreetPremium() {
  const GOLD = "#FFD84D";
  const RED = "#FF3B30";
  const G = (o: number) => `rgba(255,216,77,${o})`;

  const features = [
    { icon: "🎵", label: "AI Song Writing", tag: "HOT" },
    { icon: "🎬", label: "Music Video AI", tag: "NEW" },
    { icon: "🖼", label: "Thumbnails", tag: null },
    { icon: "📢", label: "Promo Content", tag: null },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#000",
      fontFamily: "'Arial Black', 'Arial Bold', system-ui, sans-serif",
      overflow: "hidden",
      position: "relative",
    }}>

      {/* Red diagonal slash accent — top left */}
      <div style={{
        position: "absolute",
        top: -60, left: -40,
        width: 220, height: 220,
        background: `linear-gradient(135deg, ${RED}22 0%, transparent 60%)`,
        transform: "rotate(-15deg)",
        pointerEvents: "none",
      }} />

      {/* Gold slash — bottom right */}
      <div style={{
        position: "absolute",
        bottom: -40, right: -40,
        width: 300, height: 300,
        background: `linear-gradient(135deg, transparent 40%, ${G(0.08)} 100%)`,
        pointerEvents: "none",
      }} />

      {/* ── NAV ── */}
      <nav style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 48px",
        height: 64,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        position: "relative", zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontSize: 16, fontWeight: 900, color: "#fff",
            letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            BOW DOWN{" "}
            <span style={{ color: GOLD, textShadow: `0 0 12px ${G(0.6)}` }}>VISUALS</span>
          </span>
          <div style={{
            background: RED, borderRadius: 4, padding: "2px 7px",
            fontSize: 8.5, fontWeight: 900, color: "#fff", letterSpacing: "0.12em",
          }}>BETA</div>
        </div>

        <div style={{ display: "flex", gap: 28 }}>
          {["Tools", "Pricing", "FAQ", "Beta Access"].map((item) => (
            <span key={item} style={{
              fontSize: 12.5, color: "rgba(255,255,255,0.5)",
              fontWeight: 700, cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
            }}>{item}</span>
          ))}
        </div>

        <button style={{
          height: 40, padding: "0 24px", borderRadius: 6,
          background: GOLD,
          border: "none",
          color: "#000", fontWeight: 900, fontSize: 13,
          cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase",
        }}>START NOW →</button>
      </nav>

      {/* ── HERO ── */}
      <div style={{
        position: "relative", zIndex: 5,
        padding: "40px 48px 60px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 48, alignItems: "center",
        maxWidth: 1200, margin: "0 auto",
      }}>

        {/* LEFT — text */}
        <div>
          {/* "BETA OPEN" badge */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            marginBottom: 22,
            border: `1px solid ${RED}80`,
            borderRadius: 4, padding: "4px 12px",
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: RED, boxShadow: `0 0 6px ${RED}` }} />
            <span style={{ fontSize: 10, fontWeight: 900, color: RED, letterSpacing: "0.16em" }}>BETA ACCESS OPEN</span>
          </div>

          {/* Big headline — stacked */}
          <div style={{ marginBottom: 24 }}>
            <p style={{
              fontSize: 11, fontWeight: 900, color: "rgba(255,255,255,0.3)",
              letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 8,
            }}>The Content Creator's Cheat Code</p>
            <h1 style={{
              fontSize: 58, fontWeight: 900, lineHeight: 0.95,
              color: "#fff", textTransform: "uppercase",
              letterSpacing: "-0.01em",
              margin: 0,
            }}>
              CREATE<br />
              <span style={{ color: GOLD, textShadow: `0 0 30px ${G(0.5)}` }}>MUSIC</span><br />
              VIDEOS<br />
              <span style={{ color: GOLD, textShadow: `0 0 30px ${G(0.5)}` }}>WITH AI</span>
            </h1>
          </div>

          <p style={{
            fontSize: 14.5, color: "rgba(255,255,255,0.4)",
            lineHeight: 1.65, marginBottom: 32, maxWidth: 420,
            fontFamily: "system-ui, sans-serif", fontWeight: 400,
          }}>
            Songs. Lyrics. Video treatments. Thumbnails. Promo campaigns. All AI-powered, all in one place.
          </p>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button style={{
              height: 52, padding: "0 30px", borderRadius: 6,
              background: GOLD, border: "none",
              color: "#000", fontWeight: 900, fontSize: 14,
              cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
            }}>🎬 START CREATING</button>
            <button style={{
              height: 52, padding: "0 24px", borderRadius: 6,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.55)",
              fontWeight: 700, fontSize: 13,
              cursor: "pointer", letterSpacing: "0.06em", textTransform: "uppercase",
            }}>JOIN WAITLIST</button>
          </div>

          {/* Feature tags */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 32 }}>
            {features.map((f) => (
              <div key={f.label} style={{
                display: "flex", alignItems: "center", gap: 7,
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6, padding: "7px 12px",
                background: "rgba(255,255,255,0.03)",
              }}>
                <span style={{ fontSize: 15 }}>{f.icon}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.6)", letterSpacing: "0.04em" }}>
                  {f.label}
                </span>
                {f.tag && (
                  <span style={{
                    fontSize: 7.5, fontWeight: 900, letterSpacing: "0.1em",
                    color: f.tag === "HOT" ? RED : GOLD,
                    background: f.tag === "HOT" ? `${RED}22` : `${G(0.1)}`,
                    border: `1px solid ${f.tag === "HOT" ? RED + "50" : G(0.3)}`,
                    borderRadius: 3, padding: "1px 5px",
                  }}>{f.tag}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — mascot / visual */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          {/* Spotlight */}
          <div style={{
            position: "absolute",
            width: 380, height: 380, borderRadius: "50%",
            background: `radial-gradient(circle, ${G(0.12)} 0%, transparent 70%)`,
            filter: "blur(20px)",
          }} />
          {/* Outer ring */}
          <div style={{
            position: "absolute",
            width: 340, height: 340, borderRadius: "50%",
            border: `1px solid ${G(0.12)}`,
          }} />
          <div style={{
            position: "absolute",
            width: 270, height: 270, borderRadius: "50%",
            border: `1px solid rgba(255,255,255,0.04)`,
          }} />
          {/* Mascot */}
          <div style={{
            fontSize: 160,
            filter: `drop-shadow(0 0 40px ${G(0.35)}) drop-shadow(0 4px 20px rgba(0,0,0,0.8))`,
            position: "relative", zIndex: 2,
          }}>🦈</div>

          {/* Corner accent lines */}
          {[
            { top: 10, left: 10, borderTop: `2px solid ${G(0.5)}`, borderLeft: `2px solid ${G(0.5)}`, borderRadius: "4px 0 0 0" },
            { top: 10, right: 10, borderTop: `2px solid ${G(0.5)}`, borderRight: `2px solid ${G(0.5)}`, borderRadius: "0 4px 0 0" },
            { bottom: 10, left: 10, borderBottom: `2px solid ${G(0.5)}`, borderLeft: `2px solid ${G(0.5)}`, borderRadius: "0 0 0 4px" },
            { bottom: 10, right: 10, borderBottom: `2px solid ${G(0.5)}`, borderRight: `2px solid ${G(0.5)}`, borderRadius: "0 0 4px 0" },
          ].map((style, i) => (
            <div key={i} style={{ position: "absolute", width: 24, height: 24, ...style }} />
          ))}
        </div>
      </div>
    </div>
  );
}
