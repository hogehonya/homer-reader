import { describe, expect, it } from "vitest";
import { parseBook, parseCatalog, parseRoute } from "./data-contract";
import { fixtureBook, fixtureCatalog } from "./fixtures";

describe("reader data contract", () => {
  it("parses supported routes and rejects unknown works and volume boundaries", () => {
    expect(parseRoute("#/iliad/1")).toEqual({ kind: "book", workId: "iliad", bookNumber: 1 });
    expect(parseRoute("#/odyssey/24")).toEqual({ kind: "book", workId: "odyssey", bookNumber: 24 });
    expect(parseRoute("#/voices").kind).toBe("invalid");
    expect(parseRoute("#/unknown/1").kind).toBe("invalid");
    expect(parseRoute("#/iliad/0").kind).toBe("invalid");
    expect(parseRoute("#/iliad/25").kind).toBe("invalid");
    expect(parseRoute("#/iliad/1/extra").kind).toBe("invalid");
    expect(parseRoute("#/")).toEqual({ kind: "select" });
  });

  it("rejects catalog metadata with unsafe links, unsupported works, and malformed volumes", () => {
    expect(parseCatalog(fixtureCatalog).works).toHaveLength(2);
    expect(() => parseCatalog("{not-json")).toThrow(/valid JSON/);

    const badUrl = structuredClone(fixtureCatalog);
    badUrl.works[0].source.english.url = "javascript:alert(1)";
    expect(() => parseCatalog(badUrl)).toThrow(/HTTPS/);

    const badWork = structuredClone(fixtureCatalog) as unknown as Record<string, unknown>;
    (badWork.works as Array<Record<string, unknown>>)[0].id = "hades";
    expect(() => parseCatalog(badWork)).toThrow(/work ID/);

    const badBook = structuredClone(fixtureCatalog);
    badBook.works[0].books[0].dataFile = "../../outside.json";
    expect(() => parseCatalog(badBook)).toThrow(/data path/);
  });

  it("rejects incomplete units and note kinds rather than showing an empty book as loaded", () => {
    expect(parseBook(fixtureBook())).toEqual(fixtureBook());
    expect(() => parseBook({ workId: "iliad", bookNumber: 1, units: [] })).toThrow(/at least one/);
    expect(() => parseBook("{broken")).toThrow(/valid JSON/);

    const badNote = structuredClone(fixtureBook());
    badNote.units[0].notes[0].kind = "hero" as "person";
    expect(() => parseBook(badNote)).toThrow(/note kind/);

    const missingJapanese = structuredClone(fixtureBook());
    missingJapanese.units[0].ja = "  ";
    expect(() => parseBook(missingJapanese)).toThrow(/non-empty/);
  });

  it("requires non-empty English note titles and bodies while preserving both languages", () => {
    const parsed = parseBook(fixtureBook());
    expect(parsed.units[0].notes[0]).toMatchObject({
      title: "詩の呼びかけ",
      titleEn: "Poetic invocation",
      body: "詩人が物語を始めるための言葉です。",
      bodyEn: "The poet calls upon the goddess to begin the tale.",
    });

    const missingTitle = structuredClone(fixtureBook());
    delete (missingTitle.units[0].notes[0] as unknown as Record<string, unknown>).titleEn;
    expect(() => parseBook(missingTitle)).toThrow(/titleEn.*non-empty/);

    const emptyBody = structuredClone(fixtureBook());
    (emptyBody.units[0].notes[0] as unknown as Record<string, unknown>).bodyEn = "  ";
    expect(() => parseBook(emptyBody)).toThrow(/bodyEn.*non-empty/);
  });

  it("rejects a book that does not match the catalog's selected identity and unit count", () => {
    expect(() => parseBook(fixtureBook("odyssey", 1), {
      workId: "iliad", bookNumber: 1, unitCount: 1,
    })).toThrow(/does not match/);
    expect(() => parseBook(fixtureBook("iliad", 2), {
      workId: "iliad", bookNumber: 1, unitCount: 1,
    })).toThrow(/does not match/);
    expect(() => parseBook(fixtureBook(), {
      workId: "iliad", bookNumber: 1, unitCount: 2,
    })).toThrow(/unit count/);
  });
});
