import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptToken,
  decryptToken,
  isSocialTokenKeyConfigured,
} from "../social-crypto";

const TEST_KEY = "a".repeat(64); // 32 bytes of 0xaa
const OTHER_KEY = "b".repeat(64);

describe("social-crypto", () => {
  const orig = process.env["SOCIAL_TOKEN_KEY"];

  beforeEach(() => {
    process.env["SOCIAL_TOKEN_KEY"] = TEST_KEY;
  });
  afterEach(() => {
    if (orig === undefined) delete process.env["SOCIAL_TOKEN_KEY"];
    else process.env["SOCIAL_TOKEN_KEY"] = orig;
  });

  it("round-trips a token", () => {
    const secret = "EAALongLivedPageAccessToken123";
    expect(decryptToken(encryptToken(secret))).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const a = encryptToken("same-secret");
    const b = encryptToken("same-secret");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("same-secret");
    expect(decryptToken(b)).toBe("same-secret");
  });

  it("fails closed when SOCIAL_TOKEN_KEY is missing", () => {
    delete process.env["SOCIAL_TOKEN_KEY"];
    expect(() => encryptToken("x")).toThrow(/SOCIAL_TOKEN_KEY/);
    expect(() => decryptToken("a:b:c")).toThrow(/SOCIAL_TOKEN_KEY/);
    expect(isSocialTokenKeyConfigured()).toBe(false);
  });

  it("fails closed when SOCIAL_TOKEN_KEY is malformed", () => {
    process.env["SOCIAL_TOKEN_KEY"] = "not-hex";
    expect(() => encryptToken("x")).toThrow(/SOCIAL_TOKEN_KEY/);
    expect(isSocialTokenKeyConfigured()).toBe(false);
  });

  it("detects tampering", () => {
    const payload = encryptToken("secret");
    const [iv, enc, tag] = payload.split(":");
    // flip a hex char in the ciphertext
    const tampered = `${iv}:${enc!.slice(0, -1)}${enc!.slice(-1) === "0" ? "1" : "0"}:${tag}`;
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("cannot decrypt with a different key", () => {
    const payload = encryptToken("secret");
    process.env["SOCIAL_TOKEN_KEY"] = OTHER_KEY;
    expect(() => decryptToken(payload)).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decryptToken("no-colons")).toThrow(/malformed/);
    expect(() => decryptToken("a:b:c:d")).toThrow(/malformed/);
  });
});
