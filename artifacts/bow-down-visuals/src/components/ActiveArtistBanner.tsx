import { Link } from "wouter";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

const GOLD = "#C9A84C";
const G = (o: number) => `rgba(201,168,76,${o})`;

interface Props {
  artist: ArtistVault;
  onContinue: () => void;
}

export function ActiveArtistBanner({ artist, onContinue }: Props) {
  const hasImage = !!artist.reference_image_url;
  const hasConsistency = !!(artist.consistency_prompt || artist.reference_image_url);

  const initials = artist.artist_name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const traits = [
    artist.genre,
    artist.visual_style,
    artist.brand_colors,
    artist.hair,
  ].filter(Boolean) as string[];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── Cinematic identity card ── */}
      <div style={{
        borderRadius: 24,
        overflow: "hidden",
        border: `1.5px solid ${G(0.4)}`,
        background: "#0a0800",
        boxShadow: `0 0 60px ${G(0.12)}, 0 8px 40px rgba(0,0,0,0.7)`,
        position: "relative",
      }}>

        {/* ── Top band: photo or initials avatar ── */}
        <div style={{
          height: 180,
          background: hasImage
            ? `url(${artist.reference_image_url!}) center/cover no-repeat`
            : "linear-gradient(135deg, #1a1200 0%, #0d0800 60%, #000 100%)",
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

          {/* Ambient glow */}
          <div style={{
            position: "absolute", top: "20%", left: "30%",
            width: 200, height: 200, borderRadius: "50%",
            background: `radial-gradient(circle, ${G(0.1)} 0%, transparent 70%)`,
            pointerEvents: "none",
          }} />

          {/* Initials avatar (no image) */}
          {!hasImage && (
            <div style={{
              position: "relative",
              width: 72, height: 72, borderRadius: "50%",
              background: `linear-gradient(135deg, ${G(0.25)} 0%, ${G(0.06)} 100%)`,
              border: `2px solid ${G(0.4)}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 24px ${G(0.25)}`,
            }}>
              <span style={{
                fontFamily: "Georgia, serif",
                fontSize: 22, fontWeight: 900,
                color: GOLD, letterSpacing: "0.05em",
              }}>{initials}</span>
            </div>
          )}

          {/* Left gold accent bar */}
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
            background: `linear-gradient(to bottom, ${GOLD}, ${G(0)})`,
          }} />

          {/* ACTIVE badge */}
          <div style={{
            position: "absolute", top: 14, right: 14,
            display: "flex", alignItems: "center", gap: 5,
            background: G(0.15),
            border: `1px solid ${G(0.4)}`,
            borderRadius: 8, padding: "4px 10px",
            backdropFilter: "blur(8px)",
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%",
              background: GOLD, boxShadow: `0 0 6px ${GOLD}`,
            }} />
            <span style={{ fontSize: 9, fontWeight: 900, color: GOLD, letterSpacing: "0.14em" }}>
              ACTIVE
            </span>
          </div>

          {/* Name + type overlaid on bottom of band */}
          <div style={{ position: "absolute", bottom: 14, left: 20, right: 20 }}>
            <p style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: 24, fontWeight: 900, color: "#fff",
              letterSpacing: "0.05em",
              textShadow: "0 2px 12px rgba(0,0,0,0.9)",
              lineHeight: 1.1,
            }}>{artist.artist_name}</p>
            {artist.artist_type && (
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 3, letterSpacing: "0.04em" }}>
                {artist.artist_type}
              </p>
            )}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "16px 20px 20px" }}>

          {/* Trait pills */}
          {traits.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {traits.map((trait, i) => (
                <span key={trait} style={{
                  fontSize: 10, fontWeight: 700,
                  color: i === 0 ? GOLD : "rgba(255,255,255,0.45)",
                  background: i === 0 ? G(0.08) : "rgba(255,255,255,0.04)",
                  border: `1px solid ${i === 0 ? G(0.25) : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 6, padding: "3px 8px",
                }}>{trait}</span>
              ))}
            </div>
          )}

          {/* Consistency lock */}
          {hasConsistency && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: G(0.05),
              border: `1px solid ${G(0.18)}`,
              borderRadius: 10, padding: "8px 12px",
              marginBottom: 16,
            }}>
              <span style={{ fontSize: 12 }}>🔒</span>
              <div>
                <p style={{ fontSize: 10, fontWeight: 800, color: GOLD, letterSpacing: "0.08em" }}>
                  CONSISTENCY LOCK ACTIVE
                </p>
                <p style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                  {artist.reference_image_url
                    ? "Reference image + style rules guide every AI prompt"
                    : "Style rules guide every AI prompt"}
                </p>
              </div>
            </div>
          )}

          {/* Personality preview */}
          {artist.personality && (
            <p style={{
              fontSize: 11, color: "rgba(255,255,255,0.3)",
              lineHeight: 1.6, marginBottom: 14,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}>{artist.personality}</p>
          )}

          {/* Primary CTA */}
          <button
            onClick={onContinue}
            data-testid="btn-continue-active-artist"
            style={{
              width: "100%", height: 48, borderRadius: 14,
              border: `1.5px solid ${G(0.5)}`,
              background: `linear-gradient(135deg, ${G(0.18)} 0%, ${G(0.08)} 100%)`,
              color: GOLD, fontSize: 13, fontWeight: 900,
              letterSpacing: "0.05em", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              boxShadow: `0 0 20px ${G(0.15)}, inset 0 1px 0 ${G(0.2)}`,
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 15 }}>▶</span>
            Continue with {artist.artist_name}
          </button>

          {/* Secondary actions */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Link href="/choose-artist">
              <button style={{
                width: "100%", height: 36, borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.02)",
                color: "rgba(255,255,255,0.45)",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>Change Artist</button>
            </Link>
            <Link href="/artist-vault">
              <button style={{
                width: "100%", height: 36, borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.02)",
                color: "rgba(255,255,255,0.45)",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>Edit Details</button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
