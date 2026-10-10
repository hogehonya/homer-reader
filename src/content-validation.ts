import { parseBook, parseCatalog, type Catalog } from "./data-contract.ts";

export interface ContentSummary {
  workCount: number;
  bookCount: number;
  unitCount: number;
}

export type JsonLoader = (path: string) => unknown | Promise<unknown>;

export async function validateContent(loadJson: JsonLoader): Promise<ContentSummary> {
  let catalog: Catalog;
  try {
    catalog = parseCatalog(await loadJson("catalog.json"));
  } catch (error) {
    throw new Error(`公開前の48巻データを検証できません: ${message(error)}`);
  }

  let bookCount = 0;
  let unitCount = 0;
  const files = new Set<string>();
  const unitIds = new Set<string>();
  for (const work of catalog.works) {
    const actualNumbers = work.books.map((book) => book.number).sort((a, b) => a - b);
    if (actualNumbers.length !== 24 || actualNumbers.some((number, index) => number !== index + 1)) {
      throw new Error(`${work.id} must list books 1 through 24 exactly once`);
    }
    for (const bookIndex of work.books) {
      if (files.has(bookIndex.dataFile)) throw new Error(`duplicate data file reference: ${bookIndex.dataFile}`);
      files.add(bookIndex.dataFile);
      let book;
      try {
        book = parseBook(await loadJson(bookIndex.dataFile), {
          workId: work.id,
          bookNumber: bookIndex.number,
          unitCount: bookIndex.unitCount,
        });
      } catch (error) {
        throw new Error(`${bookIndex.dataFile}: ${message(error)}`);
      }
      for (const unit of book.units) {
        if (!unit.id.startsWith(`${work.id}-${String(bookIndex.number).padStart(2, "0")}-`)) {
          throw new Error(`${bookIndex.dataFile}: unit ID is outside its work and book: ${unit.id}`);
        }
        if (unitIds.has(unit.id)) throw new Error(`duplicate translation unit ID: ${unit.id}`);
        unitIds.add(unit.id);
      }
      bookCount += 1;
      unitCount += book.units.length;
    }
  }

  if (bookCount !== 48) throw new Error(`expected 48 book files, found ${bookCount}`);
  return { workCount: catalog.works.length, bookCount, unitCount };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
