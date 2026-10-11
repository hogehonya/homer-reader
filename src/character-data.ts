import characterDataJson from "./character-relations.json?raw";
import type { WorkId } from "./data-contract";

export interface Character {
  id: string;
  nameEn: string;
  nameJa: string;
  aliasesEn: string[];
  aliasesJa: string[];
  firstBook: number;
}

export interface CharacterRelation {
  id: string;
  from: string;
  to: string;
  kind: string;
  labelEn: string;
  labelJa: string;
  minBook: number;
  unitId: string;
  evidence: { en: string };
}

export interface CharacterWork {
  workId: WorkId;
  characters: Character[];
  relations: CharacterRelation[];
}

interface CharacterDataFile {
  schema: "homer-character-relations-v1";
  noticeJa: string;
  visibilityRule: string;
  sourcePolicy: string;
  works: Array<CharacterWork & {
    source: { title: string; translator: string; projectGutenbergId: number; url: string };
  }>;
}

const characterData = JSON.parse(characterDataJson) as CharacterDataFile;

export const characterMapMetadata = {
  schema: characterData.schema,
  noticeJa: characterData.noticeJa,
  visibilityRule: characterData.visibilityRule,
  sourcePolicy: characterData.sourcePolicy,
} as const;

export function getCharacterMap(workId: WorkId, bookNumber: number): CharacterWork {
  const work = characterData.works.find((item) => item.workId === workId)!;
  const characters = work.characters.filter((character) => character.firstBook <= bookNumber);
  const characterIds = new Set(characters.map((character) => character.id));
  const relations = work.relations.filter((relation) =>
    relation.minBook <= bookNumber && characterIds.has(relation.from) && characterIds.has(relation.to),
  );
  return { workId, characters, relations };
}
