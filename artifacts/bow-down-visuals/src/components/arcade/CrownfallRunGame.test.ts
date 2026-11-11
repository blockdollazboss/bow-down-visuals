/**
 * Crownfall Run — owner-ruling pins (Nov 10, 2026, v1 + v2).
 *
 * The FE suite runs in node (no DOM/canvas harness — same constraint
 * as the sibling arcade games), so these tests pin the ruled behavior
 * in source, the house honest-load way:
 *
 * v1 rulings (still standing):
 * 1. AUTO-SHOOT IS OFF (owner, twice confirmed). The King fires ONLY
 *    along the player's aim. No nearest-foe targeting anywhere in
 *    the firing path; no aim input means no shots, ever.
 * 2. Aim inputs: pad right stick (never steering), touch aim stick,
 *    recent mouse over the arena — resolved in that priority.
 * 3. NO TELEPORT: the golden door starts a walk-through passage
 *    (phase "transit"); the next floor is generated during it.
 * 4. The King is the purpose-drawn sprite (no portrait cutout),
 *    every room kind carries set dressing, and pickups load the
 *    site's real Visual Buc coin art.
 *
 * v2 rulings (owner, Nov 10, later that day):
 * 5. FULLSCREEN on run start + a HUD toggle; refusal is swallowed.
 * 6. COIN PURSE + SHOP: pickups fill a purse, not the score; the
 *    between-floor shop sells priced upgrades + six guns; buying
 *    applies at once and the shop stays open; DESCEND IS FREE,
 *    always; unaffordable items name the shortfall; the leftover
 *    purse converts at run end (+25/coin). Scrip (prestige/bounty)
 *    spends first and NEVER converts.
 * 7. GUNS switch mid-run (keys 1–6, pad LB/RB, touch switcher) and
 *    never change the manual-fire rule; elites may drop a gun, the
 *    boss always does; a claimed drop equips.
 * 8. BIGGER MAPS: a 1080×1080 world behind a 720×720 camera view,
 *    with a minimap. Difficulty ramp by the shared table; Chargers
 *    unlock floor 3, Spam Slingers floor 4; boss cycles add summons,
 *    a spread shot, then speed. Second Wind revives exactly once.
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
    const fire = slice("function fireBolts(", "/* Crown Mortar blast");
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

  it("switching guns never touches the fire rule", () => {
    const sw = slice("function switchGun(", "function cycleGun(");
    expect(sw).not.toContain("fireBolts");
    expect(sw).not.toContain("aim.on = true");
    expect(sw).toContain("P.guns.includes(id)");
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
    const resolve = slice("function resolveAim(", "/* ─── guns:");
    const padAt = resolve.indexOf("g.padAim.on");
    const touchAt = resolve.indexOf("g.aimJoy.on");
    const mouseAt = resolve.indexOf("g.mouseAim");
    expect(padAt).toBeGreaterThanOrEqual(0);
    expect(touchAt).toBeGreaterThan(padAt);
    expect(mouseAt).toBeGreaterThan(touchAt);
    expect(resolve).toContain("g.aim.on = false;");
  });

  it("mouse aim is converted from view into world coordinates", () => {
    const resolve = slice("function resolveAim(", "/* ─── guns:");
    expect(resolve).toContain("ma.x + g.cam.x - P.x");
    expect(resolve).toContain("ma.y + g.cam.y - P.y");
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
    expect(door).not.toContain("openShop(g)");
  });

  it("the passage generates the next floor BEFORE the walk and locks the phase", () => {
    const begin = slice("function beginTransit(", "function updateTransit(");
    expect(begin).toContain('g.phase = "transit"');
    expect(begin).toContain("genFloor(g, g.depth, bgAlt)");
    expect(begin).toContain("snapObstacles");
    /* both rooms keep their own camera: the old room's is captured */
    expect(begin).toContain("camFromX");
  });

  it("arrival (not the doorstep) opens the shop, in the new room", () => {
    const transit = slice("function updateTransit(", "/* ─── run flow");
    expect(transit).toContain('g.phase = "upgrade"');
    expect(transit).toContain("openShop(g)");
    expect(transit).toContain("g.bgSwap = true");
    /* the run clock does not advance during the passage */
    const update = slice("function update(", "function crownPath(");
    expect(update).toContain('if (g.phase === "transit") { updateTransit(g, dt); return; }');
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
    expect(foe).toContain("GLITCH CHARGER");
    expect(foe).toContain("SPAM SLINGER");
    expect(foe).toContain('e.state === "aim"');
  });

  it("juice is capped: particles never exceed the hard cap", () => {
    const burstFn = slice("function burst(", "function floater(");
    expect(burstFn).toContain("PARTICLE_CAP");
    expect(src).toContain("const PARTICLE_CAP = 240;");
  });

  it("kill-streak callouts fire at chain 5 / 10 / 20", () => {
    const kill = slice("function killEnemy(", "/* Resolve the player's aim");
    expect(kill).toContain('g.combo === 5');
    expect(kill).toContain("ON A TEAR");
    expect(kill).toContain('g.combo === 10');
    expect(kill).toContain("RAMPAGE");
    expect(kill).toContain('g.combo === 20');
    expect(kill).toContain("UNSTOPPABLE");
  });
});

describe("crownfall v2: fullscreen", () => {
  it("starting a run requests fullscreen on the game container", () => {
    expect(src).toContain("requestGameFullscreen(rootRef.current)");
    const start = slice("const startFromUi", "/* the fullscreen toggle's truth");
    expect(start).toContain("requestGameFullscreen");
    expect(start).toContain("startRun");
  });

  it("the request is guarded: a refusal is swallowed, never thrown", () => {
    const req = slice("function requestGameFullscreen(", "function exitGameFullscreen(");
    expect(req).toContain("el.requestFullscreen?.()");
    expect(req).toContain("p.catch");
    expect(req).toContain("document.fullscreenElement");
  });

  it("a HUD toggle exists and its state comes from the document", () => {
    expect(src).toContain('data-testid="crownfall-fullscreen"');
    expect(src).toContain("toggleGameFullscreen(rootRef.current)");
    expect(src).toContain('"fullscreenchange"');
    expect(src).toContain("setFsActive(!!document.fullscreenElement)");
  });

  it("exiting fullscreen never touches run state", () => {
    const exit = slice("function exitGameFullscreen(", "function toggleGameFullscreen(");
    expect(exit).toContain("document.exitFullscreen?.()");
    expect(exit).not.toContain("phase");
    expect(exit).not.toContain("startRun");
  });
});

describe("crownfall v2: the coin purse + shop", () => {
  it("a coin pickup fills the PURSE, not the score", () => {
    const pickups = slice("/* ---- pickups ---- */", "/* ---- the golden door:");
    expect(pickups).toContain("g.purse++");
    expect(pickups).not.toContain("g.crowns++");
  });

  it("mid-run score excludes the purse; run-end score converts the leftover", () => {
    const mid = slice("function scoreOf(", "function finalScoreOf(");
    expect(mid).toContain("crownfallScore(g.depth, 0, g.kills, g.comboBonus)");
    const fin = slice("function finalScoreOf(", "function camSnapToPlayer(");
    expect(fin).toContain("crownfallScore(g.depth, g.purse, g.kills, g.comboBonus)");
    /* scrip NEVER converts — prestige cannot inflate a score */
    expect(fin).not.toContain("scrip");
  });

  it("spending burns scrip before score coins", () => {
    const spend = slice("function spendPurse(", "function buildShopSnap(");
    expect(spend).toContain("Math.min(g.scrip, price)");
    expect(spend).toContain("g.purse -= price - fromScrip");
  });

  it("the shop always offers a free descend — a broke King is never trapped", () => {
    const snap = slice("function buildShopSnap(", "function shopItemCount(");
    expect(snap).toContain('kind: "descend"');
    expect(snap).toContain("price: 0, affordable: true");
    const descend = slice("function descend(", "function shopActivate(");
    expect(descend).toContain('g.phase = "playing"');
    expect(descend).toContain("g.ui.shop(null)");
    expect(descend).not.toContain("spendPurse");
  });

  it("buying an upgrade deducts, applies, removes the card, and STAYS in the shop", () => {
    const act = slice("function shopActivate(", "/* ─── the door passage");
    expect(act).toContain("spendPurse(g, item.price)");
    expect(act).toContain("u.apply(g.P)");
    expect(act).toContain("g.upgradePicks = g.upgradePicks.filter");
    expect(act).toContain("refreshShop(g)");
    /* the only way shopActivate starts the fight is Descend */
    expect(act).toContain('if (item.kind === "descend") { descend(g); return; }');
  });

  it("unaffordable items name the price and the exact shortfall", () => {
    const snap = slice("function buildShopSnap(", "function shopItemCount(");
    expect(snap).toContain("shortfall: Math.max(0, price - total)");
    const act = slice("function shopActivate(", "/* ─── the door passage");
    expect(act).toContain("you need ");
    expect(act).toContain("item.shortfall");
  });

  it("elites still drop exactly 2 coins (before event doubling)", () => {
    const kill = slice("function killEnemy(", "/* Resolve the player's aim");
    expect(kill).toContain("dropCoins(g, e.x, e.y, 2 * dropMul)");
  });
});

describe("crownfall v2: guns", () => {
  it("fireBolts dispatches on the equipped gun's pattern", () => {
    const fire = slice("function fireBolts(", "function enemyShoot(");
    expect(fire).toContain("crownfallGun(P.gun)");
    expect(fire).toContain('gun.pattern === "twin"');
    expect(fire).toContain("push(a, px * 7, py * 7)"); /* parallel bolts */
    expect(fire).toContain('gun.pattern === "scatter"');
    expect(fire).toContain("-0.34, -0.17, 0, 0.17, 0.34"); /* the 5-bolt fan */
    expect(fire).toContain("gun.pierce"); /* the Rail Lance pierces */
    expect(fire).toContain("gun.splash"); /* the Crown Mortar splashes */
  });

  it("buying a gun in the shop deducts and equips it", () => {
    const act = slice("function shopActivate(", "/* ─── the door passage");
    expect(act).toContain("g.P.guns.push(item.id)");
    expect(act).toContain("g.P.gun = item.id; /* a bought gun equips on purchase */");
  });

  it("number keys 1–6, pad LB/RB, and a touch switcher all switch guns", () => {
    expect(src).toContain("CROWNFALL_GUNS[Number(k) - 1]");
    const poll = slice("function pollGamepad(", "/* ─── upgrade icons");
    expect(poll).toContain("padEdge(g, gp, 4)");
    expect(poll).toContain("padEdge(g, gp, 5)");
    expect(poll).toContain("cycleGun(g, -1)");
    expect(poll).toContain("cycleGun(g, 1)");
    expect(src).toContain('data-testid="crownfall-gun-next"');
  });

  it("elites can drop a gun; the boss always does; claiming equips it", () => {
    const kill = slice("function killEnemy(", "/* Resolve the player's aim");
    expect(kill).toContain("dropGunPickup(g, e.x, e.y + 16); /* the boss ALWAYS drops a gun (while any remain) */");
    expect(kill).toContain("if (Math.random() < 0.25) dropGunPickup(g, e.x, e.y);");
    const drop = slice("function dropGunPickup(", "function killEnemy(");
    expect(drop).toContain("CROWNFALL_GUNS.filter((gun) => !g.P.guns.includes(gun.id))");
    const pickups = slice("/* ---- pickups ---- */", "/* ---- the golden door:");
    expect(pickups).toContain("claimed and equipped");
    expect(pickups).toContain("P.gun = pk.gunId");
  });

  it("the run summary carries an armory line", () => {
    const dieFn = slice("function die(", "/* ─── player actions");
    expect(dieFn).toContain("armory: g.P.guns.map((id) => crownfallGun(id).name)");
    expect(src).toContain("Armory:");
  });
});

describe("crownfall v2: bigger maps + camera + minimap", () => {
  it("the world is 1080×1080 behind a 720×720 view", () => {
    expect(src).toContain("const LW = CROWNFALL.worldWidth;");
    expect(src).toContain("const VW = CROWNFALL.width;");
    expect(src).toContain("cam: { x: number; y: number }");
  });

  it("the camera eases after the King and clamps to the room", () => {
    const cam = slice("/* ---- the camera:", "/* ---- manual fire:");
    expect(cam).toContain("clamp(P.x - VW / 2, 0, LW - VW)");
    expect(cam).toContain("g.cam.x += (tx - g.cam.x) * ease");
  });

  it("the minimap draws King, foes, door and pickups", () => {
    const mm = slice("function drawMinimap(", "let vignetteCache");
    expect(mm).toContain("g.doorOpen");
    expect(mm).toContain("for (const pk of g.pickups)");
    expect(mm).toContain("for (const e of g.enemies)");
    expect(mm).toContain("g.P.x * sx");
  });

  it("static dressing is pre-rendered to the offscreen backdrop per floor", () => {
    expect(src).toContain("function makeBg(");
    expect(src).toContain("clutter pass");
  });
});

describe("crownfall v2: difficulty ramp + new threats", () => {
  it("genFloor spawns from the shared difficulty table", () => {
    const gen = slice("function genFloor(", "/* ─── floor backdrop");
    expect(gen).toContain("crownfallFoesForFloor(d)");
    expect(gen).toContain("crownfallHpScale(d)");
    expect(gen).toContain("crownfallEliteChance(d)");
    expect(gen).toContain("crownfallBossHp(d)");
  });

  it("Chargers never appear before floor 3, Slingers never before floor 4", () => {
    const gen = slice("function genFloor(", "/* ─── floor backdrop");
    expect(gen).toContain('if (d >= 3 && rng() < 0.22) type = "charger";');
    expect(gen).toContain('if (d >= 4 && rng() < 0.22) type = "spambot";');
  });

  it("the boss gains a pattern per cycle: summons (2+), spread (3+)", () => {
    const boss = slice('} else if (e.type === "boss") {', "/* gentle separation");
    expect(boss).toContain("crownfallBossCycle(g.depth)");
    /* join19: summons are solo-only (the MP referee has no summon
       registration), so the cycle gate carries the g.mp guard */
    expect(boss).toContain("if (!g.mp && cycle >= 2 && e.summons < 2)");
    expect(boss).toContain("g.spawnQueue.push(\"chaser\")");
    /* join19: boss bolts aim at the party target (T.x, T.y) */
    expect(boss).toContain("if (cycle >= 3) { enemyShoot(g, e, 285, 12, 0.3, T.x, T.y);");
    /* summons are capped: two waves, at most 3 per wave (cycle 4+) */
    expect(boss).toContain("const perWave = cycle >= 4 ? 3 : 2;");
  });

  it("the combo is a multiplier: bonus accrues at (mult − 1) × 10 per kill", () => {
    const kill = slice("function killEnemy(", "/* Resolve the player's aim");
    expect(kill).toContain("crownfallComboMult(g.combo)");
    expect(kill).toContain("g.comboBonus += (mult - 1) * CROWNFALL.killPoints");
  });

  it("Second Wind triggers exactly once: the flag is spent before the revive", () => {
    const dmg = slice("function damagePlayer(", "/* Coin drops:");
    const windAt = dmg.indexOf("if (P.secondWind)");
    expect(windAt).toBeGreaterThanOrEqual(0);
    expect(dmg).toContain("P.secondWind = false;");
    expect(dmg).toContain("P.hp = Math.floor(P.maxhp * 0.5);");
    /* the revive returns BEFORE death is on the table */
    expect(dmg.indexOf("P.secondWind = false;")).toBeLessThan(dmg.indexOf("die(g, bg)"));
    /* and it starts un-bought every run */
    expect(src).toContain("thorn: 0, secondWind: false, shield: false,");
  });

  it("the shield absorbs exactly one hit before any HP is lost", () => {
    const dmg = slice("function damagePlayer(", "/* Coin drops:");
    expect(dmg.indexOf("if (P.shield)")).toBeGreaterThanOrEqual(0);
    expect(dmg.indexOf("if (P.shield)")).toBeLessThan(dmg.indexOf("P.hp -= dmg"));
    expect(dmg).toContain("P.shield = false;");
  });

  it("the Thorn Sash bites foes that touch the King", () => {
    const foe = slice("function updateEnemy(", "/* ─── upgrades");
    expect(foe).toContain("P.thorn > 0");
    expect(foe).toContain("e.thornT = 0.4;");
  });

  it("event rooms roll on non-boss floors from floor 2", () => {
    const gen = slice("function genFloor(", "/* ─── floor backdrop");
    expect(gen).toContain('if (er < 0.12) g.event = "jackpot";');
    expect(gen).toContain('else if (er < 0.24) g.event = "ambush";');
  });
});

describe("crownfall v2: sound + prestige", () => {
  it("buy and boss-roar sounds are synthesized, and the mute toggle persists", () => {
    expect(src).toContain("buy() { tone(920, 0,");
    expect(src).toContain("roar() { tone(58, 34,");
    expect(src).toContain('data-testid="crownfall-mute"');
    expect(src).toContain("saveCrownfallMuted(next); /* the preference persists */");
    expect(src).toContain("loadCrownfallMuted()");
  });

  it("prestige multiplies base damage and drops scrip — power, not score", () => {
    expect(src).toContain("dmg: CROWNFALL.baseDamage * prestigeDamageMult(tier),");
    const drops = slice("function dropCoins(", "function dropGunPickup(");
    expect(drops).toContain("prestigeCoinChance(g.meta.tier)");
    expect(drops).toContain('kind: "scrip"');
  });

  it("the Royal Bounty lands in scrip on the first run of the day", () => {
    const start = slice("function startRun(", "function die(");
    expect(start).toContain("claimRoyalBounty(g.meta, todayLocal())");
    expect(start).toContain("g.scrip += bounty.granted;");
  });

  it("a boss-beating run ends in a coin fountain and a prestige offer", () => {
    const dieFn = slice("function die(", "/* ─── player actions");
    expect(dieFn).toContain("if (g.bossKills > 0) g.fountainT = 1.8;");
    expect(dieFn).toContain("canPrestige: g.bossKills > 0 && recorded.tier < PRESTIGE_TIER_CAP");
    expect(src).toContain('data-testid="crownfall-prestige"');
    expect(src).toContain("claimPrestigeTier(g.meta)");
  });
});
