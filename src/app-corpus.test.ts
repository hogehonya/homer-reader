// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReaderApp, type ReaderApp } from "./app";
import { parseBook, parseCatalog } from "./data-contract";

const corpusFiles = import.meta.glob<string>("../public/data/**/*.json", { eager: true, query: "?raw", import: "default" });
const catalog = parseCatalog(readData("data/catalog.json"));
const books = catalog.works.flatMap((work) => work.books.map((book) => ({ work, book })));

function readData(path: string): unknown {
  return JSON.parse(corpusFiles[`../public/${path}`]!);
}

describe("published corpus in the reader DOM", () => {
  let app: ReaderApp | undefined;
  afterEach(() => {
    app?.destroy();
    app = undefined;
    document.body.replaceChildren();
  });

  it.each(books)("preserves $work.id book $book.number across all three reading tabs", async ({ work, book }) => {
    const data = parseBook(readData(book.dataFile), {
      workId: work.id, bookNumber: book.number, unitCount: book.unitCount,
    });
    const root = document.createElement("div");
    document.body.append(root);
    window.history.replaceState({}, "", `/#/${work.id}/${book.number}`);
    const fetcher = async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith("catalog.json") ? catalog : data,
    ));
    app = createReaderApp(root, { fetcher, window, speechSynthesis: null });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelectorAll(".unit")).toHaveLength(data.units.length));

    const originalNodes = [...root.querySelectorAll<HTMLElement>(".unit")];
    const expected = data.units.map((unit) => ({
      id: unit.id,
      reference: unit.reference,
      en: unit.en,
      ja: unit.ja,
      notes: unit.notes.map((note) => ({
        spoiler: String(note.spoiler),
        titleEn: note.titleEn,
        title: note.title,
        bodyEn: note.bodyEn,
        body: note.body,
        sourceUrl: note.sourceUrl ?? null,
      })),
    }));

    for (const mode of ["bilingual", "english", "japanese"]) {
      root.querySelector<HTMLButtonElement>(`[role='tab'][data-reading-mode='${mode}']`)!.click();
      const nodes = [...root.querySelectorAll<HTMLElement>(".unit")];
      expect(nodes.every((node, index) => node === originalNodes[index])).toBe(true);
      const actual = nodes.map((unit) => ({
        id: unit.id,
        reference: unit.querySelector(".unit__reference")!.textContent,
        en: unit.querySelector(".unit__english")!.textContent,
        ja: unit.querySelector(".unit__japanese")!.textContent,
        notes: [...unit.querySelectorAll<HTMLDetailsElement>(".note__details")].map((note) => ({
          spoiler: note.dataset.spoiler,
          titleEn: note.querySelector(".note__title--english, .note__locale--english .note__locale-title")!.textContent,
          title: note.querySelector(".note__title--japanese, .note__locale--japanese .note__locale-title")!.textContent,
          bodyEn: note.querySelector(".note__locale--english .note__locale-body")!.textContent,
          body: note.querySelector(".note__locale--japanese .note__locale-body")!.textContent,
          sourceUrl: note.querySelector(".note__source a")?.getAttribute("href") ?? null,
        })),
      }));
      expect(actual).toEqual(expected);
      for (const unit of nodes) {
        expect(unit.querySelector<HTMLElement>(".translation--english")!.hidden).toBe(mode === "japanese");
        expect(unit.querySelector<HTMLElement>(".translation--japanese")!.hidden).toBe(mode === "english");
        for (const note of unit.querySelectorAll<HTMLDetailsElement>(".note__details")) {
          expect(note.open).toBe(false);
        }
      }
    }
  });
});
