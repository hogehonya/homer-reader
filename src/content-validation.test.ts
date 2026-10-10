import { describe, expect, it } from "vitest";
import { validateContent } from "./content-validation";
import { fixtureBook, fixtureCatalog } from "./fixtures";

describe("publication content gate", () => {
  it("accepts only a complete 48-book catalog with every referenced JSON book", async () => {
    const catalog = fullFixtureCatalog();
    const summary = await validateContent(async (path) => {
      if (path === "catalog.json") return catalog;
      const match = /^data\/(iliad|odyssey)\/(\d{2})\.json$/.exec(path);
      if (!match) throw new Error(`unexpected path ${path}`);
      return fixtureBook(match[1] as "iliad" | "odyssey", Number(match[2]));
    });
    expect(summary).toEqual({ workCount: 2, bookCount: 48, unitCount: 48 });
  });

  it("fails closed when a full-volume entry or file is absent", async () => {
    const missingBook = structuredClone(fullFixtureCatalog());
    missingBook.works[0].books.pop();
    await expect(validateContent(async (path) => path === "catalog.json" ? missingBook : fixtureBook()))
      .rejects.toThrow(/books 1 through 24/);

    const catalog = fullFixtureCatalog();
    await expect(validateContent(async (path) => {
      if (path === "catalog.json") return catalog;
      if (path === "data/odyssey/24.json") throw new Error("file not found");
      const match = /^data\/(iliad|odyssey)\/(\d{2})\.json$/.exec(path)!;
      return fixtureBook(match[1] as "iliad" | "odyssey", Number(match[2]));
    })).rejects.toThrow(/data\/odyssey\/24\.json/);
  });

  it("fails closed when a volume has an invalid unit or mismatched count", async () => {
    const catalog = fullFixtureCatalog();
    await expect(validateContent(async (path) => {
      if (path === "catalog.json") return catalog;
      if (path === "data/iliad/01.json") return { ...fixtureBook("iliad", 1), units: [] };
      const match = /^data\/(iliad|odyssey)\/(\d{2})\.json$/.exec(path)!;
      return fixtureBook(match[1] as "iliad" | "odyssey", Number(match[2]));
    })).rejects.toThrow(/at least one translation unit/);
  });
});

function fullFixtureCatalog() {
  const catalog = structuredClone(fixtureCatalog);
  catalog.works = catalog.works.map((work) => ({
    ...work,
    books: Array.from({ length: 24 }, (_, index) => {
      const number = index + 1;
      return {
        number,
        titleJa: `${number}巻`,
        unitCount: 1,
        dataFile: `data/${work.id}/${String(number).padStart(2, "0")}.json`,
      };
    }),
  }));
  return catalog;
}
