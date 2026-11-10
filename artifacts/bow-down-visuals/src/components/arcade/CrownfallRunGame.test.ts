/**
 * Crownfall Run — owner-ruling pins (Nov 10, 2026).
 *
 * The FE suite runs in node (no DOM/canvas harness — same constraint
 * as the sibling arcade games), so these tests pin the ruled behavior
 * in source, the house honest-load way:
 *
 * 1. AUTO-SHOOT IS OFF (owner, twice confirmed). The King fires ONLY
 *    along the player's aim. There must be no nearest-foe targeting
 *    anywhere in the firing path, and the fire call must be gated on
 *    aim existing at all — no aim input means no shots, ever.
 * 2. Aim inputs: pad right stick (never steering), touch aim stick,
 *    recent mouse over the arena — resolved in that priority.
 * 3. NO TELEPORT: the golden door starts a walk-through passage
 *    (phase "transit"); the next floor is generated during the
 *    passage and the upgrade pick no longer generates a floor.
 * 4. The King is the purpose-drawn sprite (no portrait cutout is
 *    loaded into the game), every room kind carries set dressing,
 *    and pickups load the site's real Visual Buc coin art.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./CrownfallRunGame.tsx", import.meta.url), "utf8");

function slice(from: string, to: string): string {
  const a = src.indexOf(from);
  expect(a, `expected to find: ${from}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a);
  expect(b, `expected to find after ${from}: ${to}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

describe("crownfall: auto-shoot stays OFF (owner ruling)", () => {
  it("fireBolts refuses to fire without aim and never hunts a target", () => {
    const fire = slice("function fireBolts(", "function enemyShoot(");
    expect(fire).toContain("if (!g.aim.on) return;");
    expect(fire).toContain("Math.atan2(g.aim.y, g.aim.x)");
    /* no nearest-foe search, no target variable, no range gate */
    expect(fire).not.toContain("tgt");
    expect(fire).not.toContain("dist2");
    expect(fire).not.toContain("470");
  });

  it("the update loop only fires while aim is held, and readies instantly otherwise", () => {
    const loop = slice("/* ---- manual fire:", "/* ---- player bolts ---- */");
    expect(loop).toContain("resolveAim(g)");
    expect(loop).toContain("if (g.aim.on && g.enemies.length)");
    expect(loop).toContain("else g.fireTimer = 0;");
  });

  it("spread and multishot fan around the AIM axis, not around targets", () => {
    const fire = slice("function fireBolts(", "function enemyShoot(");
    expect(fire).toContain("const a = base + off;");
    expect(fire).toContain("P.spread");
    expect(fire).toContain("P.multishot");
  });

  it("no copy anywhere promises automatic fire", () => {
    expect(src).not.toContain("fires golden bolts at the nearest foe");
    expect(src).toContain("your shots go where you point");
  });
});

describe("crownfall: aim inputs (pad / touch / mouse)", () => {
  it("the pad's right stick aims and never steers", () => {
    const poll = slice("function pollGamepad(", "/* ─── upgrade icons");
    expect(poll).toContain("g.padAim.on = true");
    expect(poll).toContain("right stick AIMS");
    expect(poll).not.toContain("right stick steers");
    /* movement comes from the left stick vector alone */
    expect(poll).toContain("g.padVec.x = dx; g.padVec.y = dy;");
  });

  it("resolveAim priority is pad, then touch stick, then recent mouse", () => {
    const resolve = slice("function resolveAim(", "function fireBolts(");
    const padAt = resolve.indexOf("g.padAim.on");
    const touchAt = resolve.indexOf("g.aimJoy.on");
    const mouseAt = resolve.indexOf("g.mouseAim");
    expect(padAt).toBeGreaterThanOrEqual(0);
    expect(touchAt).toBeGreaterThan(padAt);
    expect(mouseAt).toBeGreaterThan(touchAt);
    expect(resolve).toContain("g.aim.on = false;");
  });

  it("touch aim is a real second stick on the right side", () => {
    expect(src).toContain("g.aimJoy.on = true");
    expect(src).toContain("aimJoyBaseRef");
    expect(src).toContain("right side: the AIM stick");
  });

  it("the aim is shown: a gold indicator is drawn while aiming", () => {
    const renderAim = slice("/* aim indicator", "/* arrow pointing to the open golden door */");
    expect(renderAim).toContain("g.aim.on");
    expect(renderAim).toContain("#f0c94f");
  });
});

describe("crownfall: no teleport — the door passage", () => {
  it("stepping through the door begins the passage, not an instant swap", () => {
    const door = slice("/* ---- the golden door:", "g.ui.hud();\n}");
    expect(door).toContain("beginTransit(g, bg, bgAlt ?? bg)");
    expect(door).not.toContain("showUpgrades(g)");
  });

  it("the passage generates the next floor BEFORE the walk and locks the phase", () => {
    const begin = slice("function beginTransit(", "function updateTransit(");
    expect(begin).toContain('g.phase = "transit"');
    expect(begin).toContain("genFloor(g, g.depth, bgAlt)");
    expect(begin).toContain("snapObstacles");
  });

  it("arrival (not the doorstep) deals the upgrade cards, in the new room", () => {
    const transit = slice("function updateTransit(", "/* ─── run flow");
    expect(transit).toContain('g.phase = "upgrade"');
    expect(transit).toContain("showUpgrades(g)");
    expect(transit).toContain("g.bgSwap = true");
    /* the run clock does not advance during the passage */
    const update = slice("function update(", "function crownPath(");
    expect(update).toContain('if (g.phase === "transit") { updateTransit(g, dt); return; }');
  });

  it("picking an upgrade no longer teleports: it generates nothing", () => {
    const pick = slice("function pickUpgrade(", "/* ─── the door passage");
    expect(pick).not.toContain("genFloor");
    expect(pick).not.toContain("g.depth++");
    expect(pick).toContain('g.phase = "playing"');
  });

  it("pad input during the passage is consumed, never queued", () => {
    const poll = slice("function pollGamepad(", "/* ─── upgrade icons");
    const at = poll.indexOf('if (g.phase === "transit")');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(poll.slice(at, at + 260)).toContain("return;");
  });

  it("the passage is short: walk + slide ≈ 1.1s", () => {
    expect(src).toContain("const TRANSIT_WALK_SEC = 0.32;");
    expect(src).toContain("const TRANSIT_SLIDE_SEC = 0.78;");
  });
});

describe("crownfall: the designed look", () => {
  it("the King is the purpose-drawn sprite — no portrait art is loaded", () => {
    expect(src).toContain("function drawKingSprite(");
    expect(src).not.toContain("shark-king");
    /* the King's identity marks are all in the sprite */
    const king = slice("function drawKingSprite(", "function drawKing(");
    expect(king).toContain("crownPath");
    expect(king).toContain("fishbone pendant");
    expect(king).toContain("#6d1420"); /* the wine sash */
  });

  it("every room kind dresses its obstacles and genFloor assigns the skins", () => {
    for (const kind of ["lobby", "beatlab", "studio", "green", "mixing", "vault", "throne", "server"]) {
      expect(src).toContain(`${kind}: [`);
    }
    expect(src).toContain("o.skin = skins[i % skins.length]");
    for (const skin of ["desk", "planter", "workdesk", "speakers", "camera", "lightstand", "console", "goldbars", "coinpile", "rack", "brazier"]) {
      expect(src).toContain(`skin === "${skin}"`);
    }
    /* the green screen is unmistakable */
    expect(src).toContain('kind === "green"');
    expect(src).toContain("#1faa59");
  });

  it("pickups are the site's real Visual Buc coin art", () => {
    expect(src).toContain('mediaUrl("images/visual-bucs-icon.webp")');
    expect(src).toContain("setCoinImage(coin)");
    expect(src).toContain("ctx.drawImage(coinImg, -11, -11, 22, 22)");
  });

  it("foes are designed sprites, and the Troll telegraph survives", () => {
    const foe = slice("function drawEnemy(", "function drawDoor(");
    expect(foe).toContain("GLITCH — shard polygon");
    expect(foe).toContain("SPAM BOT — boxy bot");
    expect(foe).toContain("TROLL — hunched brute");
    expect(foe).toContain('e.state === "aim"');
  });
});
