import { describe, expect, it } from "vitest";
import {
  applyVaultCharacter,
  refreshStageVaultAvatars,
  refreshVaultAvatarSettings,
  unlinkVaultCharacter,
  type VaultCharacter,
} from "./avatar-vault";
import { fetchVaultCharacters } from "../world/characters";
import {
  createScene,
  createSource,
  type AvatarSettings,
  type Scene,
} from "./scenes";

function character(partial: Partial<VaultCharacter> = {}): VaultCharacter {
  return {
    id: "vault-1",
    name: "Shark King",
    portraitUrl: "https://img.example/shark-king.png",
    ...partial,
  };
}

function settings(partial: Partial<AvatarSettings> = {}): AvatarSettings {
  return { character: "shark", drive: "voice", sensitivity: 1.25, ...partial };
}

describe("the vault roster read (the picker's list)", () => {
  it("lists every vault character with its name and portrait from the row", async () => {
    const payload = {
      vaults: [
        { id: "v-1", artist_name: "Shark King", reference_image_url: "https://img.example/king.png" },
        { id: "v-2", artist_name: "Nova Vale", reference_image_url: "https://img.example/nova.png", reference_video_url: "https://img.example/nova-loop.mp4" },
        { id: "v-3", artist_name: "No Portrait Yet", reference_image_url: null },
      ],
    };
    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    })) as unknown as typeof fetch;
    const chars = await fetchVaultCharacters(async () => "token-1", fetchFn);
    expect(chars.map((c) => c.id)).toEqual(["v-1", "v-2", "v-3"]);
    expect(chars[0]).toEqual({
      id: "v-1",
      name: "Shark King",
      portraitUrl: "https://img.example/king.png",
      loopUrl: null,
    });
    /* The loop lane's identity keying rides the same roster read: a
       row's reference_video_url arrives as loopUrl. */
    expect(chars[1]!.loopUrl).toBe("https://img.example/nova-loop.mp4");
    expect(chars[2]!.portraitUrl).toBeNull();
    expect(chars[2]!.loopUrl).toBeNull();
  });
});

describe("applyVaultCharacter", () => {
  it("goes live as the character: upload rig, the row's portrait, name and id", () => {
    const next = applyVaultCharacter(settings(), character());
    expect(next.character).toBe("upload");
    expect(next.imageUrl).toBe("https://img.example/shark-king.png");
    expect(next.vaultId).toBe("vault-1");
    expect(next.vaultName).toBe("Shark King");
  });

  it("keeps the performer's own drive and sensitivity", () => {
    const next = applyVaultCharacter(settings({ drive: "idle", sensitivity: 0.7 }), character());
    expect(next.drive).toBe("idle");
    expect(next.sensitivity).toBe(0.7);
  });

  it("a portrait-less row keeps the previous picture rather than blanking", () => {
    const next = applyVaultCharacter(
      settings({ imageUrl: "https://img.example/previous.png" }),
      character({ portraitUrl: null }),
    );
    expect(next.imageUrl).toBe("https://img.example/previous.png");
    expect(next.vaultId).toBe("vault-1");
  });
});

describe("unlinkVaultCharacter", () => {
  it("drops the link and nothing else", () => {
    const linked = applyVaultCharacter(settings(), character());
    const unlinked = unlinkVaultCharacter(linked);
    expect(unlinked.vaultId).toBeUndefined();
    expect(unlinked.vaultName).toBeUndefined();
    expect(unlinked.character).toBe("upload");
    expect(unlinked.imageUrl).toBe(linked.imageUrl);
    expect(unlinked.drive).toBe(linked.drive);
  });

  it("is a no-op (same object) when there is no link", () => {
    const plain = settings();
    expect(unlinkVaultCharacter(plain)).toBe(plain);
  });
});

describe("refreshVaultAvatarSettings", () => {
  it("an unlinked avatar never refreshes", () => {
    expect(refreshVaultAvatarSettings(settings(), [character()])).toBeNull();
  });

  it("reflects an edited portrait and name from the live row", () => {
    const linked = applyVaultCharacter(settings(), character());
    const edited = character({
      name: "Shark King II",
      portraitUrl: "https://img.example/king-NEW.png",
    });
    const next = refreshVaultAvatarSettings(linked, [edited]);
    expect(next).not.toBeNull();
    expect(next!.imageUrl).toBe("https://img.example/king-NEW.png");
    expect(next!.vaultName).toBe("Shark King II");
    expect(next!.vaultId).toBe("vault-1");
    expect(next!.character).toBe("upload");
  });

  it("returns null when the row already matches the settings", () => {
    const linked = applyVaultCharacter(settings(), character());
    expect(refreshVaultAvatarSettings(linked, [character()])).toBeNull();
  });

  it("a vanished row keeps the last resolved picture as the fallback", () => {
    const linked = applyVaultCharacter(settings(), character());
    expect(refreshVaultAvatarSettings(linked, [])).toBeNull();
    expect(linked.imageUrl).toBe("https://img.example/shark-king.png");
  });
});

describe("refreshStageVaultAvatars (studio load)", () => {
  function fakeStage(scene: Scene) {
    const calls: Array<{ sceneId: string; sourceId: string }> = [];
    return {
      scenes: [scene],
      calls,
      updateSource(sceneId: string, sourceId: string, patch: { avatar?: AvatarSettings }) {
        calls.push({ sceneId, sourceId });
        const src = scene.sources.find((s) => s.id === sourceId);
        if (src && patch.avatar) src.avatar = patch.avatar;
      },
    };
  }

  it("refreshes only the linked avatar sources, from the live rows", () => {
    const linkedSource = createSource("avatar");
    linkedSource.avatar = applyVaultCharacter(linkedSource.avatar!, character());
    const stockSource = createSource("avatar");
    const scene = createScene("Main", [linkedSource, stockSource, createSource("camera")]);
    const stage = fakeStage(scene);

    const edited = character({ portraitUrl: "https://img.example/king-EDITED.png" });
    const refreshed = refreshStageVaultAvatars(stage, [edited]);

    expect(refreshed).toBe(1);
    expect(stage.calls).toEqual([{ sceneId: scene.id, sourceId: linkedSource.id }]);
    expect(linkedSource.avatar!.imageUrl).toBe("https://img.example/king-EDITED.png");
    expect(stockSource.avatar!.vaultId).toBeUndefined();
  });

  it("does nothing when the roster is empty or nothing moved", () => {
    const linkedSource = createSource("avatar");
    linkedSource.avatar = applyVaultCharacter(linkedSource.avatar!, character());
    const stage = fakeStage(createScene("Main", [linkedSource]));
    expect(refreshStageVaultAvatars(stage, [])).toBe(0);
    expect(refreshStageVaultAvatars(stage, [character()])).toBe(0);
    expect(stage.calls).toEqual([]);
  });
});

describe("settings persistence", () => {
  it("vaultId and vaultName survive the scene JSON round-trip", () => {
    const source = createSource("avatar");
    source.avatar = applyVaultCharacter(source.avatar!, character());
    const scene = createScene("Main", [source]);
    const revived = JSON.parse(JSON.stringify(scene)) as Scene;
    const avatar = revived.sources[0]!.avatar!;
    expect(avatar.vaultId).toBe("vault-1");
    expect(avatar.vaultName).toBe("Shark King");
    expect(avatar.character).toBe("upload");
    expect(avatar.imageUrl).toBe("https://img.example/shark-king.png");
  });
});
