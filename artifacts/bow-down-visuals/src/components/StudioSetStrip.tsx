/* StudioSetStrip — a film-set silhouette (cinema camera on tripod, two
   softbox light stands, a boom mic, a director's chair) standing on a soft
   stage-floor gradient. It straddles the seam between the hero and the
   social-proof band: the hero's backdrop/fog edges and the band's top edge
   used to print two ruler-straight lines across the smoke (owner
   screenshots, 2026-10-12). The owner asked for the seam to be covered by
   "a camera set up / light set up" — so the set stands on the seam and
   the floor gradient melts both edges away underneath it.
   LAYERING (owner directive 2026-10-12): the set sits at z-[3] — above
   the backdrop (z-0), grain (z-1) and spotlight beams (z-2), but BEHIND
   the King (z-4) and behind ALL hero text (copy column z-10). It used
   to ride at z-30 and drew its silhouettes over the proof/share rows;
   the owner ordered it behind the text. Do not raise it back.
   Pure decoration: pointer-events-none, aria-hidden. */

export function StudioSetStrip({ isLight }: { isLight: boolean }) {
  const silhouette = isLight ? "#2A1E07" : "#060504";
  const glow = isLight ? "rgba(168,135,31,0.20)" : "rgba(212,160,23,0.16)";
  const panel = isLight ? "rgba(122,90,18,0.35)" : "rgba(245,214,122,0.30)";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative z-[3] -mt-[216px] h-[184px] w-full sm:-mt-[244px] sm:h-[208px]"
    >
      {/* Stage floor — the actual seam cover: a soft gradient floor that
          fades in over the hero's bottom edge and melts into the band. */}
      <div
        className="absolute inset-0"
        style={{
          background: isLight
            ? "linear-gradient(to bottom, transparent 0%, rgba(120,90,30,0.10) 42%, rgba(120,90,30,0.24) 72%, rgba(120,90,30,0.12) 90%, transparent 100%)"
            : "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.52) 42%, rgba(0,0,0,0.92) 72%, rgba(0,0,0,0.55) 90%, transparent 100%)",
        }}
      />
      <svg
        viewBox="0 0 1440 240"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 h-full w-full"
        style={{
          color: silhouette,
          filter: isLight
            ? "drop-shadow(0 8px 14px rgba(122,90,18,0.30))"
            : "drop-shadow(0 -3px 10px rgba(212,160,23,0.30))",
        }}
      >
        {/* floor shadow */}
        <ellipse cx="720" cy="230" rx="690" ry="9" fill={isLight ? "rgba(90,66,16,0.30)" : "rgba(0,0,0,0.55)"} />

        {/* key light glow + softbox (left) */}
        <ellipse cx="238" cy="66" rx="86" ry="52" fill={glow} />
        <g>
          <rect x="243" y="86" width="7" height="128" fill="currentColor" />
          <polygon points="246,214 214,232 232,232 248,220" fill="currentColor" />
          <polygon points="247,214 252,220 268,232 284,232 252,214" fill="currentColor" />
          <g transform="rotate(24 246 66)">
            <polygon points="212,38 280,38 292,84 200,84" fill="currentColor" />
            <polygon points="220,44 272,44 280,78 212,78" fill={panel} />
          </g>
          <rect x="240" y="80" width="14" height="10" rx="2" fill="currentColor" />
        </g>

        {/* cinema camera on tripod (center-left, facing right) */}
        <g>
          <polygon points="560,148 516,230 534,230 562,168" fill="currentColor" />
          <polygon points="566,148 574,230 592,230 574,166" fill="currentColor" />
          <polygon points="572,148 622,230 640,230 580,164" fill="currentColor" />
          <circle cx="566" cy="146" r="9" fill="currentColor" />
          <rect x="540" y="128" width="10" height="22" fill="currentColor" />
          {/* body */}
          <rect x="498" y="82" width="118" height="54" rx="9" fill="currentColor" />
          {/* film magazine */}
          <rect x="522" y="64" width="58" height="20" rx="8" fill="currentColor" />
          {/* top handle */}
          <rect x="536" y="56" width="34" height="7" rx="3" fill="currentColor" />
          {/* viewfinder */}
          <rect x="482" y="94" width="18" height="14" rx="3" fill="currentColor" />
          {/* lens + matte box */}
          <polygon points="616,94 656,88 656,130 616,124" fill="currentColor" />
          <rect x="656" y="82" width="16" height="54" rx="3" fill="currentColor" />
          {/* tally light */}
          <circle cx="606" cy="92" r="4" fill="#E8B33C" />
        </g>

        {/* director's chair (center-right) */}
        <g>
          <polygon points="928,168 990,224 1000,224 940,168" fill="currentColor" />
          <polygon points="990,168 928,224 938,224 998,168" fill="currentColor" />
          <rect x="920" y="158" width="86" height="10" rx="3" fill="currentColor" />
          <rect x="924" y="104" width="8" height="58" fill="currentColor" />
          <rect x="986" y="104" width="8" height="58" fill="currentColor" />
          <rect x="920" y="98" width="78" height="14" rx="4" fill="currentColor" />
        </g>

        {/* fill light + boom mic (right) */}
        <ellipse cx="1180" cy="80" rx="76" ry="46" fill={glow} />
        <g>
          <rect x="1176" y="98" width="7" height="116" fill="currentColor" />
          <polygon points="1179,214 1148,232 1166,232 1181,220" fill="currentColor" />
          <polygon points="1180,214 1186,220 1202,232 1218,232 1185,214" fill="currentColor" />
          <g transform="rotate(-22 1180 78)">
            <polygon points="1148,52 1212,52 1222,94 1138,94" fill="currentColor" />
            <polygon points="1155,58 1205,58 1213,88 1147,88" fill={panel} />
          </g>
          <rect x="1173" y="92" width="14" height="10" rx="2" fill="currentColor" />
        </g>
      </svg>
    </div>
  );
}
