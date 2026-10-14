/* StudioSetStrip — a film-set silhouette standing on a soft stage-floor
   gradient across the seam between the hero and the social-proof band.
   The hero's backdrop/fog edges and the band's top edge used to print two
   ruler-straight lines across the smoke (owner screenshots, 2026-10-12);
   the owner asked for the seam to be covered by "a camera set up / light
   set up" — so the set stands on the seam and the floor gradient melts
   both edges away underneath it.
   LAYERING (owner directive 2026-10-13): the set rides at z-[20] — in
   front of the ground fog/smoke (z-2) and in front of the hero's lower
   rows in the seam overlap, like foreground film equipment. The smoke
   layer sits below the set and below the text.
   SIZE (owner directive 2026-10-13, later the same day): "make the
   studio set taller — like triple its size." Strip 210/240px ->
   630/720px, scene re-authored on a 1440x720 canvas; each equipment
   group scales up around the shared floor line (lights x2.8, camera
   x2.2, chair x1.9). Every foot lands exactly on the floor (y=720) and
   the whole set fits the frame at every width.
   SIZE — SUPERSEDED (owner verdict 2026-10-14, staging screenshot):
   "The studio set is way too big." At the tripled size the strip's
   pull-up carried the panels, camera and boom up through the hero's
   copy column — the boom crossed the headline, the right softbox
   chopped the body copy mid-line, the left panel covered the small
   King in the backdrop art. The set is now a BOUNDED STAGE: the scene
   renders at ~53% (svg wrapper capped at 765px wide on sm+, 500px on
   phones) and the strip stands mostly BELOW the hero's bottom edge
   (only 150/216px of pull-up, carrying the floor gradient and the
   boom's butt end into the hero's bottom fog zone). The geometry —
   not z-index — keeps every set piece clear of the copy column
   (whose bottom edge sits 64px above the hero's bottom) and clear
   of the small King at every width: measured zero overlaps at
   2048px and 390px in both themes (preview-rig boxes, 2026-10-14).
   The triple-size + paint-over orders above are retired by this
   ruling; layer order itself is unchanged (fog -> set -> King ->
   copy).
   REDESIGN (owner directive 2026-10-13, evening): at the tripled size
   the original strip-drawn camera read as "a blob with a cone" (owner:
   "I don't know what this supposed to be — we gonna have to redesign
   that"). The artwork is now drawn to be READ at full size: a cinema
   camera with a sloped film magazine, top handle, eyepiece, a real
   lens cylinder with rings and a flagged matte box, on a two-stage
   tripod with a mid-spreader and pan handle; softboxes drawn as
   tilted lit panels on stands; and the boom mic the set always claimed
   to have, reaching in over the right light. Silhouette language
   unchanged (one color + a lit panel tone + the tally light).
   FIT (owner directive 2026-10-12): preserveAspectRatio is "meet",
   NEVER "slice" — slice cropped the softbox tops on wide screens and
   BOTH lights clean off the edges on phones ("chopped off"). Meet
   keeps the whole set in frame at every width, anchored to the floor
   (YMax). (The glows may bleed a few units past the side edges — a
   halo is light, not equipment; every silhouette stays in frame.)
   Pure decoration: pointer-events-none, aria-hidden. */

export function StudioSetStrip({ isLight }: { isLight: boolean }) {
  const silhouette = isLight ? "#2A1E07" : "#060504";
  const glow = isLight ? "rgba(168,135,31,0.20)" : "rgba(212,160,23,0.16)";
  const panel = isLight ? "rgba(122,90,18,0.35)" : "rgba(245,214,122,0.30)";
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative z-[20] -mt-[150px] h-[360px] w-full sm:-mt-[216px] sm:h-[560px]"
    >
      {/* Stage floor — the actual seam cover: a soft gradient floor that
          fades in over the hero's bottom edge and melts into the band.
          The seam (hero's bottom edge) now crosses the strip at ~42%
          (base) / ~39% (sm+), so the strong zone of the gradient is
          authored around those fractions. */}
      <div
        className="absolute inset-0"
        style={{
          background: isLight
            ? "linear-gradient(to bottom, transparent 0%, rgba(120,90,30,0.10) 26%, rgba(120,90,30,0.24) 48%, rgba(120,90,30,0.12) 78%, transparent 100%)"
            : "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.52) 26%, rgba(0,0,0,0.92) 48%, rgba(0,0,0,0.55) 78%, transparent 100%)",
        }}
      />
      {/* Bounded stage — the scene no longer scales with the full hero
          width. The wrapper caps the rendered scene at 500px (phones) /
          765px (sm+); "meet" still shows the whole set, floor-anchored,
          and the strip's remaining height below the hero is the stage
          the set stands on. */}
      <div className="absolute inset-0 mx-auto w-full max-w-[500px] sm:max-w-[765px]">
      <svg
        viewBox="0 0 1440 720"
        preserveAspectRatio="xMidYMax meet"
        className="absolute inset-0 h-full w-full"
        style={{
          color: silhouette,
          filter: isLight
            ? "drop-shadow(0 8px 14px rgba(122,90,18,0.30))"
            : "drop-shadow(0 -3px 10px rgba(212,160,23,0.30))",
        }}
      >
        {/* floor shadow */}
        <ellipse cx="720" cy="712" rx="690" ry="9" fill={isLight ? "rgba(90,66,16,0.30)" : "rgba(0,0,0,0.55)"} />

        {/* boom mic — reaches in over the right side of the set (drawn in
            scene coordinates, over the right light's airspace only, so
            it never crosses the headline) */}
        <g>
          <polygon points="1432,26 1440,44 1096,196 1088,182" fill="currentColor" />
          <rect x="1420" y="8" width="18" height="30" rx="6" transform="rotate(24 1429 23)" fill="currentColor" />
          <polygon points="1092,182 1084,214 1098,216 1102,190" fill="currentColor" />
          <rect x="1078" y="212" width="12" height="30" rx="6" transform="rotate(8 1084 227)" fill="currentColor" />
          <circle cx="1084" cy="246" r="5" fill="currentColor" />
        </g>

        {/* key light (left) — tilted softbox panel on a stand, x2.8 */}
        <g transform="translate(-442.8, 70.4) scale(2.8)">
          <ellipse cx="238" cy="66" rx="86" ry="52" fill={glow} />
          {/* stand: pole + three splayed feet */}
          <rect x="243" y="92" width="7" height="122" fill="currentColor" />
          <polygon points="246,200 208,232 224,232 247,214" fill="currentColor" />
          <polygon points="247,200 243,232 257,232 250,214" fill="currentColor" />
          <polygon points="247,200 288,232 272,232 248,214" fill="currentColor" />
          {/* yoke */}
          <rect x="238" y="82" width="18" height="12" rx="3" fill="currentColor" />
          {/* softbox: outer shell + lit inner panel, tilted toward set */}
          <g transform="rotate(18 246 58)">
            <polygon points="198,26 294,26 306,92 186,92" fill="currentColor" />
            <polygon points="208,34 284,34 293,84 199,84" fill={panel} />
            <polygon points="198,26 294,26 297,36 195,36" fill="currentColor" />
          </g>
        </g>

        {/* cinema camera on tripod (center-left, facing right) — x2.2 */}
        <g transform="translate(-692.4, 214) scale(2.2)">
          {/* tripod: two-stage legs, mid-spreader, pan handle */}
          <polygon points="556,150 512,232 526,232 566,168" fill="currentColor" />
          <polygon points="576,150 586,232 600,232 584,168" fill="currentColor" />
          <polygon points="588,150 648,232 634,232 578,168" fill="currentColor" />
          <polygon points="540,196 612,196 614,202 538,202" fill="currentColor" />
          <polygon points="556,142 498,112 494,120 552,152" fill="currentColor" />
          <rect x="478" y="106" width="24" height="9" rx="4" transform="rotate(28 490 110)" fill="currentColor" />
          <circle cx="572" cy="146" r="11" fill="currentColor" />
          <rect x="548" y="128" width="12" height="22" fill="currentColor" />
          {/* body */}
          <rect x="506" y="80" width="132" height="58" rx="10" fill="currentColor" />
          <polygon points="506,80 638,80 638,94 506,100" fill="currentColor" opacity="0.55" />
          {/* film magazine — sloped hump on top */}
          <path d="M 524,80 L 532,54 Q 534,45 545,45 L 588,45 Q 599,45 601,55 L 606,80 Z" fill="currentColor" />
          {/* top handle */}
          <rect x="540" y="34" width="40" height="8" rx="4" fill="currentColor" />
          <rect x="546" y="42" width="7" height="6" fill="currentColor" />
          <rect x="568" y="42" width="7" height="6" fill="currentColor" />
          {/* eyepiece extending back */}
          <rect x="480" y="96" width="28" height="13" rx="4" fill="currentColor" />
          <circle cx="476" cy="102" r="8" fill="currentColor" />
          {/* lens cylinder + focus rings */}
          <rect x="638" y="90" width="30" height="38" rx="4" fill="currentColor" />
          <rect x="646" y="90" width="4" height="38" fill={panel} />
          <rect x="656" y="90" width="4" height="38" fill={panel} />
          {/* matte box + top flag */}
          <polygon points="668,84 702,76 702,140 668,134" fill="currentColor" />
          <polygon points="666,84 704,74 708,82 670,92" fill="currentColor" />
          {/* tally light */}
          <circle cx="630" cy="90" r="4" fill="#E8B33C" />
        </g>

        {/* director's chair (center-right) — x1.9, stays furniture-sized */}
        <g transform="translate(-864, 294.4) scale(1.9)">
          <polygon points="928,168 990,224 1000,224 940,168" fill="currentColor" />
          <polygon points="990,168 928,224 938,224 998,168" fill="currentColor" />
          <rect x="920" y="158" width="86" height="10" rx="3" fill="currentColor" />
          <rect x="924" y="104" width="8" height="58" fill="currentColor" />
          <rect x="986" y="104" width="8" height="58" fill="currentColor" />
          <rect x="920" y="98" width="78" height="14" rx="4" fill="currentColor" />
        </g>

        {/* fill light (right) — tilted softbox panel on a stand, x2.8 */}
        <g transform="translate(-2124, 70.4) scale(2.8)">
          <ellipse cx="1180" cy="80" rx="76" ry="46" fill={glow} />
          {/* stand: pole + three splayed feet */}
          <rect x="1176" y="104" width="7" height="110" fill="currentColor" />
          <polygon points="1179,200 1142,232 1158,232 1180,214" fill="currentColor" />
          <polygon points="1180,200 1176,232 1190,232 1183,214" fill="currentColor" />
          <polygon points="1180,200 1220,232 1204,232 1181,214" fill="currentColor" />
          {/* yoke */}
          <rect x="1171" y="94" width="18" height="12" rx="3" fill="currentColor" />
          {/* softbox: outer shell + lit inner panel, tilted toward set */}
          <g transform="rotate(-18 1180 70)">
            <polygon points="1132,38 1228,38 1240,104 1120,104" fill="currentColor" />
            <polygon points="1142,46 1218,46 1227,96 1133,96" fill={panel} />
            <polygon points="1132,38 1228,38 1231,48 1129,48" fill="currentColor" />
          </g>
        </g>
      </svg>
      </div>
    </div>
  );
}
