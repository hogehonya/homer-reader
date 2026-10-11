import characterDataJson from "./character-relations.json?raw";
import { describe, expect, it } from "vitest";
import { getCharacterMap, type CharacterWork } from "./character-data";
import type { WorkId, TranslationUnit, BookData } from "./data-contract";

const corpusFiles = import.meta.glob<string>("../public/data/{iliad,odyssey}/*.json", {
  eager: true,
  query: "?raw",
  import: "default",
});

interface ProposalWork extends CharacterWork {
  source: { title: string; translator: string; projectGutenbergId: number; url: string };
}

const proposal = JSON.parse(characterDataJson) as {
  schema: string;
  noticeJa: string;
  visibilityRule: string;
  sourcePolicy: string;
  works: ProposalWork[];
};

function readBook(workId: WorkId, bookNumber: number): BookData {
  const path = `../public/data/${workId}/${String(bookNumber).padStart(2, "0")}.json`;
  return JSON.parse(corpusFiles[path]!) as BookData;
}

function readUnit(unitId: string): TranslationUnit {
  const match = /^(iliad|odyssey)-(\d{2})-\d{4}$/.exec(unitId);
  if (!match) throw new Error(`Invalid evidence unit ID: ${unitId}`);
  const workId = match[1] as WorkId;
  return readBook(workId, Number(match[2])).units.find((unit) => unit.id === unitId)!;
}

describe("character relationship map", () => {
  it("keeps bilingual work metadata and unique, resolvable entities and relationships", () => {
    expect(proposal.schema).toBe("homer-character-relations-v1");
    expect(proposal.noticeJa).toContain("同じ巻の内容は含まれます");
    expect(proposal.visibilityRule).toContain("minBook");
    expect(proposal.works.map((work) => work.workId).sort()).toEqual(["iliad", "odyssey"]);

    for (const work of proposal.works) {
      const characterIds = new Set(work.characters.map((character) => character.id));
      const relationIds = new Set(work.relations.map((relation) => relation.id));
      expect(characterIds.size).toBe(work.characters.length);
      expect(relationIds.size).toBe(work.relations.length);
      for (const character of work.characters) {
        expect(character.nameEn.trim()).not.toBe("");
        expect(character.nameJa.trim()).not.toBe("");
        expect(character.firstBook).toBeGreaterThanOrEqual(1);
        expect(character.firstBook).toBeLessThanOrEqual(24);
      }
      for (const relation of work.relations) {
        expect(characterIds.has(relation.from)).toBe(true);
        expect(characterIds.has(relation.to)).toBe(true);
        expect(relation.labelEn.trim()).not.toBe("");
        expect(relation.labelJa.trim()).not.toBe("");
        expect(relation.minBook).toBe(Number(relation.unitId.slice(work.workId.length + 1, work.workId.length + 3)));
        expect(relation.unitId.startsWith(`${work.workId}-`)).toBe(true);
        const unit = readUnit(relation.unitId);
        expect(unit.en).toContain(relation.evidence.en);
        expect(relation.evidence.en.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("anchors each firstBook to a name present in that volume's Butler text", () => {
    for (const work of proposal.works) {
      for (const character of work.characters) {
        const englishText = readBook(work.workId, character.firstBook).units.map((unit) => unit.en).join("\n").toLowerCase();
        const names = [character.nameEn, ...character.aliasesEn.map((alias) => alias.split(" (")[0]!)];
        expect(names.some((name) => englishText.includes(name.toLowerCase()))).toBe(true);
      }
    }
  });

  it("reveals entities and cited relationships only at their selected-volume thresholds", () => {
    for (const work of proposal.works) {
      for (const character of work.characters) {
        const before = character.firstBook > 1 ? getCharacterMap(work.workId, character.firstBook - 1) : undefined;
        const at = getCharacterMap(work.workId, character.firstBook);
        expect(at.characters.some((item) => item.id === character.id)).toBe(true);
        if (before) expect(before.characters.some((item) => item.id === character.id)).toBe(false);
      }
      for (const relation of work.relations) {
        const before = relation.minBook > 1 ? getCharacterMap(work.workId, relation.minBook - 1) : undefined;
        const at = getCharacterMap(work.workId, relation.minBook);
        expect(at.relations.some((item) => item.id === relation.id)).toBe(true);
        expect(at.characters.some((item) => item.id === relation.from)).toBe(true);
        expect(at.characters.some((item) => item.id === relation.to)).toBe(true);
        if (before) expect(before.relations.some((item) => item.id === relation.id)).toBe(false);
      }
    }
  });
});
