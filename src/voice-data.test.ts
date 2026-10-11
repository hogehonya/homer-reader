import { describe, expect, it } from "vitest";
import { parseRoute, parseVoiceManifest } from "./data-contract";
import { fixtureVoiceManifest } from "./fixtures";

describe("voice sample route and manifest contract", () => {
  it("accepts the direct comparison route", () => {
    expect(parseRoute("#/voices")).toEqual({ kind: "voices" });
  });

  it("parses four real sample records and shared source metadata", () => {
    const parsed = parseVoiceManifest(fixtureVoiceManifest);
    expect(parsed.samples).toHaveLength(4);
    expect(parsed.samples.filter((sample) => sample.language === "en")).toHaveLength(2);
    expect(parsed.samples.filter((sample) => sample.language === "ja")).toHaveLength(2);
    expect(parsed.source.unitId).toBe("iliad-01-0001");
  });

  it("rejects missing samples, source mismatch, unsafe paths, and unlike source text hashes", () => {
    const missingSample = structuredClone(fixtureVoiceManifest) as unknown as Record<string, unknown>;
    missingSample.samples = (missingSample.samples as unknown[]).slice(0, 3);
    expect(() => parseVoiceManifest(missingSample)).toThrow(/four voice samples/);

    const wrongSource = structuredClone(fixtureVoiceManifest) as unknown as Record<string, unknown>;
    (wrongSource.source as Record<string, unknown>).unitId = "iliad-02-0001";
    expect(() => parseVoiceManifest(wrongSource)).toThrow(/source unit/);

    const unsafePath = structuredClone(fixtureVoiceManifest) as unknown as Record<string, unknown>;
    ((unsafePath.samples as Array<Record<string, unknown>>)[0]).src = "audio-samples/..%2Fsecret.mp3";
    expect(() => parseVoiceManifest(unsafePath)).toThrow(/audio path/);

    const textMismatch = structuredClone(fixtureVoiceManifest) as unknown as Record<string, unknown>;
    ((textMismatch.samples as Array<Record<string, unknown>>)[1]).textSha256 = "f".repeat(64);
    expect(() => parseVoiceManifest(textMismatch)).toThrow(/same source text/);
  });
});
