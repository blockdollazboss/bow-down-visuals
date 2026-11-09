/**
 * Scene packs for Artist Photo Shoot mode (GenerateArtistImageModal).
 *
 * A scene pack is a complete, curated shoot direction — wardrobe + pose +
 * backdrop + lighting/mood in one tap. It plugs straight into the existing
 * photo-shoot pipeline WITHOUT any modal edits beyond rendering the chips:
 *
 *   onClick → applyShootChange({ poseId: pack.poseId, outfit: pack.outfit, background: pack.background })
 *   brief   → composeScenePackBrief(pack) (delegates to composePhotoShootBrief)
 *
 * `poseId` MUST be an id from SHOOT_POSES in generate-artist-image.ts.
 * Lighting/mood is baked into `background` because composePhotoShootBrief()
 * only takes (poseId, outfit, background) — that's the format it expects.
 *
 * i18n: `nameKey` / `blurbKey` point at the catalog keys under
 * photoShoot.scenePacks.packs.* (all 10 locales carry them). `name` /
 * `blurb` are the English fallbacks the parent passes as defaultValue.
 */

import { composePhotoShootBrief } from "../generate-artist-image";

interface ScenePack {
  id: string;
  /** Catalog key for the pack name, e.g. "photoShoot.scenePacks.packs.neonStage.name" */
  nameKey: string;
  /** Catalog key for the one-line blurb, e.g. "photoShoot.scenePacks.packs.neonStage.blurb" */
  blurbKey: string;
  /** English fallback (the parent renders t(nameKey, { defaultValue: name })). */
  name: string;
  /** English fallback (the parent renders t(blurbKey, { defaultValue: blurb })). */
  blurb: string;
  /** One of SHOOT_POSES ids: "portrait" | "fullbody" | "throne" | "action" */
  poseId: string;
  /** Wardrobe fragment — same shape as ShootPreset.text */
  outfit: string;
  /** Backdrop + lighting/mood fragment — same shape as ShootPreset.text */
  background: string;
  /** Where this pack shines (display tags). */
  bestFor: string[];
}

export const SCENE_PACKS: ScenePack[] = [
  {
    id: "neon-stage",
    nameKey: "photoShoot.scenePacks.packs.neonStage.name",
    blurbKey: "photoShoot.scenePacks.packs.neonStage.blurb",
    name: "Neon Stage",
    blurb: "Electric live-energy shot — cover-art caliber, made for the single cover.",
    poseId: "action",
    outfit:
      "stage performer outfit — black leather jacket with gold embroidery, dark jeans, boots, layered gold chains",
    background:
      "on a concert stage mid-show, drenched in magenta and cyan neon laser beams cutting through haze, " +
      "crowd silhouettes with phone lights as bokeh behind, dramatic side lighting, electric high-energy atmosphere",
    bestFor: ["Album art", "Single cover", "Tour promo"],
  },
  {
    id: "rooftop-golden",
    nameKey: "photoShoot.scenePacks.packs.rooftopGolden.name",
    blurbKey: "photoShoot.scenePacks.packs.rooftopGolden.blurb",
    name: "Rooftop Golden Hour",
    blurb: "Warm, editorial press-kit shot — soft golden light, city skyline behind you.",
    poseId: "fullbody",
    outfit:
      "casual luxury — cream knit sweater, dark tailored trousers, gold bracelets, designer sunglasses held in hand",
    background:
      "on a city rooftop at golden hour, warm low sun giving a soft golden rim light, skyline glowing behind, " +
      "gentle breeze in the clothes, warm editorial mood with soft cinematic tones",
    bestFor: ["Press kit", "Bio photo", "Magazine style"],
  },
  {
    id: "studio-noir",
    nameKey: "photoShoot.scenePacks.packs.studioNoir.name",
    blurbKey: "photoShoot.scenePacks.packs.studioNoir.blurb",
    name: "Studio Noir",
    blurb: "Moody black-studio portrait — the one for your profile pic and stream branding.",
    poseId: "portrait",
    outfit:
      "all-black look — black turtleneck, black blazer, single chunky gold chain, matte black ring",
    background:
      "in a pitch-black photo studio, dramatic low-key chiaroscuro lighting with one hard rim light " +
      "carving the silhouette, faint haze catching the beam, moody cinematic intensity",
    bestFor: ["Profile pic", "Stream branding", "Logo-adjacent"],
  },
  {
    id: "street-luxury",
    nameKey: "photoShoot.scenePacks.packs.streetLuxury.name",
    blurbKey: "photoShoot.scenePacks.packs.streetLuxury.blurb",
    name: "Street Luxury",
    blurb: "Night-city flex for socials — wet asphalt, neon glow, luxury car in the frame.",
    poseId: "fullbody",
    outfit:
      "black streetwear — oversized black hoodie, black cargo pants, chunky gold chain, fresh sneakers",
    background:
      "on a luxury city street at night, wet asphalt bouncing back neon storefront reflections, " +
      "a gold sports car softly blurred in the background, cool blue-and-gold night lighting, confident street mood",
    bestFor: ["Social content", "Drop announcements", "Merch tie-in"],
  },
  {
    id: "palace-throne",
    nameKey: "photoShoot.scenePacks.packs.palaceThrone.name",
    blurbKey: "photoShoot.scenePacks.packs.palaceThrone.blurb",
    name: "Palace Throne",
    blurb: "Full Bow Down royalty — throne, gold hall, god-rays. The hero-branding shot.",
    poseId: "throne",
    outfit:
      "signature dark robe with gold trim, gold bead necklace with fish-skeleton pendant, gold crown",
    background:
      "in an opulent golden palace hall with marble columns and chandeliers, volumetric god-rays " +
      "streaming through tall windows, rich warm royal lighting, regal and powerful atmosphere",
    bestFor: ["Album art", "Hero branding", "Announcement graphics"],
  },
  {
    id: "desert-mirage",
    nameKey: "photoShoot.scenePacks.packs.desertMirage.name",
    blurbKey: "photoShoot.scenePacks.packs.desertMirage.blurb",
    name: "Desert Mirage",
    blurb: "Golden-dunes editorial — full-body heat-haze shot, made for the album campaign.",
    poseId: "fullbody",
    outfit:
      "desert editorial — sand-toned linen shirt worn open over a white tee, cream wide-leg trousers, gold pendant necklace, woven bracelets",
    background:
      "standing on golden desert dunes in late-afternoon light, wind lifting fine sand through warm backlight, " +
      "heat haze shimmering on the horizon, long shadows across rippled sand, cinematic golden editorial mood",
    bestFor: ["Album art", "Magazine style", "Tour promo"],
  },
  {
    id: "gallery-opening",
    nameKey: "photoShoot.scenePacks.packs.galleryOpening.name",
    blurbKey: "photoShoot.scenePacks.packs.galleryOpening.blurb",
    name: "Gallery Opening",
    blurb: "White-wall gallery portrait — clean, cultured, press-ready.",
    poseId: "portrait",
    outfit:
      "gallery-opening smart — charcoal tailored blazer over a black crew neck, slim black trousers, single gold brooch, polished black shoes",
    background:
      "at a white-wall gallery opening, large framed artworks softly lit on clean white walls behind, " +
      "soft museum spotlighting from above, other guests blurred deep in the background, refined quiet-luxury mood",
    bestFor: ["Press kit", "Magazine style", "Bio photo"],
  },
];

/** Composes a scene pack into the same brief format as composePhotoShootBrief. */

/** Shape expected by the modal's applyShootChange({ poseId, outfit, background }). */
