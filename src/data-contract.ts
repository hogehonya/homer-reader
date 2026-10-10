export const WORK_IDS = ["iliad", "odyssey"] as const;
export type WorkId = (typeof WORK_IDS)[number];
export type NoteKind = "person" | "place" | "myth" | "language" | "interpretation";

export interface SourceItem {
  title: string;
  translator: string;
  url?: string;
  license: string;
}

export interface WorkSource {
  english: SourceItem & { url: string };
  japanese: SourceItem;
  commentary: { author: string; method: string; reviewScope: string };
  alignment: { method: string; scope: string };
}

export interface BookIndexItem {
  number: number;
  titleJa?: string;
  unitCount: number;
  dataFile: string;
}

export interface WorkIndex {
  id: WorkId;
  titleJa: string;
  titleEn: string;
  descriptionJa: string;
  books: BookIndexItem[];
  source: WorkSource;
}

export interface Catalog {
  version: 1;
  works: WorkIndex[];
}

export interface Note {
  kind: NoteKind;
  title: string;
  titleEn: string;
  body: string;
  bodyEn: string;
  spoiler: boolean;
  sourceUrl?: string;
}

export interface TranslationUnit {
  id: string;
  reference: string;
  en: string;
  ja: string;
  notes: Note[];
}

export interface BookData {
  workId: WorkId;
  bookNumber: number;
  units: TranslationUnit[];
}

export type ReaderRoute =
  | { kind: "select" }
  | { kind: "book"; workId: WorkId; bookNumber: number }
  | { kind: "invalid"; message: string };

const NOTE_KINDS = new Set<NoteKind>(["person", "place", "myth", "language", "interpretation"]);
const DATA_FILE = /^data\/(iliad|odyssey)\/[A-Za-z0-9_-]+\.json$/;

export class DataContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataContractError";
  }
}

export function parseRoute(hash: string): ReaderRoute {
  if (hash === "" || hash === "#" || hash === "#/") return { kind: "select" };
  const match = /^#\/([^/]+)\/([^/]+)$/.exec(hash);
  if (!match || !WORK_IDS.includes(match[1] as WorkId)) {
    return { kind: "invalid", message: "作品または巻を確認できません。作品一覧から選び直してください。" };
  }
  if (!/^\d{1,2}$/.test(match[2])) {
    return { kind: "invalid", message: "巻番号を確認できません。作品一覧から選び直してください。" };
  }
  const bookNumber = Number(match[2]);
  if (bookNumber < 1 || bookNumber > 24) {
    return { kind: "invalid", message: "巻番号は1巻から24巻の範囲で選んでください。" };
  }
  return { kind: "book", workId: match[1] as WorkId, bookNumber };
}

export function parseCatalog(input: unknown): Catalog {
  const value = parseJson(input, "作品データ");
  const object = record(value, "catalog");
  if (object.version !== 1) throw new DataContractError("catalog version must be 1");
  if (!Array.isArray(object.works) || object.works.length !== 2) {
    throw new DataContractError("catalog must contain both supported works");
  }

  const works = object.works.map((raw, index): WorkIndex => {
    const work = record(raw, `works[${index}]`);
    if (!WORK_IDS.includes(work.id as WorkId)) throw new DataContractError(`works[${index}] has an unknown work ID`);
    const id = work.id as WorkId;
    const booksRaw = array(work.books, `${id}.books`);
    if (booksRaw.length === 0) throw new DataContractError(`${id}.books must not be empty`);
    const seenBooks = new Set<number>();
    const books = booksRaw.map((rawBook, bookIndex): BookIndexItem => {
      const book = record(rawBook, `${id}.books[${bookIndex}]`);
      const number = integer(book.number, `${id}.books[${bookIndex}].number`, 1, 24);
      if (seenBooks.has(number)) throw new DataContractError(`${id} has a duplicate book number`);
      seenBooks.add(number);
      const dataFile = text(book.dataFile, `${id}.books[${bookIndex}].dataFile`);
      if (!DATA_FILE.test(dataFile) || !dataFile.startsWith(`data/${id}/`)) {
        throw new DataContractError(`${id}.books[${bookIndex}] has an invalid data path`);
      }
      const titleJa = optionalText(book.titleJa, `${id}.books[${bookIndex}].titleJa`);
      return {
        number,
        ...(titleJa === undefined ? {} : { titleJa }),
        unitCount: integer(book.unitCount, `${id}.books[${bookIndex}].unitCount`, 1),
        dataFile,
      };
    }).sort((a, b) => a.number - b.number);
    const source = record(work.source, `${id}.source`);
    const englishRaw = record(source.english, `${id}.source.english`);
    const japaneseRaw = record(source.japanese, `${id}.source.japanese`);
    const commentary = record(source.commentary, `${id}.source.commentary`);
    const alignment = record(source.alignment, `${id}.source.alignment`);
    return {
      id,
      titleJa: text(work.titleJa, `${id}.titleJa`),
      titleEn: text(work.titleEn, `${id}.titleEn`),
      descriptionJa: text(work.descriptionJa, `${id}.descriptionJa`),
      books,
      source: {
        english: {
          title: text(englishRaw.title, `${id}.source.english.title`),
          translator: text(englishRaw.translator, `${id}.source.english.translator`),
          url: httpsUrl(englishRaw.url, `${id}.source.english.url`),
          license: text(englishRaw.license, `${id}.source.english.license`),
        },
        japanese: parseSourceItem(japaneseRaw, `${id}.source.japanese`),
        commentary: {
          author: text(commentary.author, `${id}.source.commentary.author`),
          method: text(commentary.method, `${id}.source.commentary.method`),
          reviewScope: text(commentary.reviewScope, `${id}.source.commentary.reviewScope`),
        },
        alignment: {
          method: text(alignment.method, `${id}.source.alignment.method`),
          scope: text(alignment.scope, `${id}.source.alignment.scope`),
        },
      },
    };
  });

  const ids = new Set(works.map((work) => work.id));
  if (ids.size !== 2 || !WORK_IDS.every((id) => ids.has(id))) {
    throw new DataContractError("catalog must contain Iliad and Odyssey exactly once");
  }
  return { version: 1, works };
}

export function parseBook(
  input: unknown,
  expected?: { workId: WorkId; bookNumber: number; unitCount: number },
): BookData {
  const value = parseJson(input, "巻データ");
  const book = record(value, "book");
  if (!WORK_IDS.includes(book.workId as WorkId)) throw new DataContractError("book has an unknown work ID");
  const workId = book.workId as WorkId;
  const bookNumber = integer(book.bookNumber, "book.bookNumber", 1, 24);
  if (expected && (workId !== expected.workId || bookNumber !== expected.bookNumber)) {
    throw new DataContractError("book does not match the selected work and volume");
  }
  const unitsRaw = array(book.units, "book.units");
  if (unitsRaw.length === 0) throw new DataContractError("book must contain at least one translation unit");
  if (expected && unitsRaw.length !== expected.unitCount) {
    throw new DataContractError("book unit count does not match catalog");
  }
  const ids = new Set<string>();
  const units = unitsRaw.map((rawUnit, index): TranslationUnit => {
    const unit = record(rawUnit, `units[${index}]`);
    const id = text(unit.id, `units[${index}].id`);
    if (ids.has(id)) throw new DataContractError("book contains duplicate unit IDs");
    ids.add(id);
    const notesRaw = array(unit.notes, `units[${index}].notes`);
    return {
      id,
      reference: text(unit.reference, `units[${index}].reference`),
      en: text(unit.en, `units[${index}].en`),
      ja: text(unit.ja, `units[${index}].ja`),
      notes: notesRaw.map((rawNote, noteIndex): Note => {
        const note = record(rawNote, `units[${index}].notes[${noteIndex}]`);
        if (!NOTE_KINDS.has(note.kind as NoteKind)) {
          throw new DataContractError(`units[${index}].notes[${noteIndex}] has an invalid note kind`);
        }
        if (typeof note.spoiler !== "boolean") {
          throw new DataContractError(`units[${index}].notes[${noteIndex}].spoiler must be a boolean`);
        }
        const sourceUrl = note.sourceUrl === undefined
          ? undefined
          : httpsUrl(note.sourceUrl, `units[${index}].notes[${noteIndex}].sourceUrl`);
        return {
          kind: note.kind as NoteKind,
          title: text(note.title, `units[${index}].notes[${noteIndex}].title`),
          titleEn: text(note.titleEn, `units[${index}].notes[${noteIndex}].titleEn`),
          body: text(note.body, `units[${index}].notes[${noteIndex}].body`),
          bodyEn: text(note.bodyEn, `units[${index}].notes[${noteIndex}].bodyEn`),
          spoiler: note.spoiler,
          ...(sourceUrl === undefined ? {} : { sourceUrl }),
        };
      }),
    };
  });
  return { workId, bookNumber, units };
}

function parseSourceItem(value: Record<string, unknown>, path: string): SourceItem {
  const url = value.url === undefined ? undefined : httpsUrl(value.url, `${path}.url`);
  return {
    title: text(value.title, `${path}.title`),
    translator: text(value.translator, `${path}.translator`),
    ...(url === undefined ? {} : { url }),
    license: text(value.license, `${path}.license`),
  };
}

function parseJson(input: unknown, label: string): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new DataContractError(`${label} is not valid JSON`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DataContractError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new DataContractError(`${path} must be an array`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DataContractError(`${path} must be non-empty text`);
  }
  return value;
}

function optionalText(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return text(value, path);
}

function integer(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new DataContractError(`${path} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function httpsUrl(value: unknown, path: string): string {
  const raw = text(value, path);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DataContractError(`${path} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:") throw new DataContractError(`${path} must use HTTPS`);
  return parsed.href;
}
