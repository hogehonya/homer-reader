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

describe("published corpus in the reader and reference panels", () => {
  let app: ReaderApp | undefined;
  afterEach(() => {
    app?.destroy();
    app = undefined;
    document.body.replaceChildren();
  });

  it.each(books)("preserves all $work.id book $book.number passages and notes in the reader DOM", async ({ work, book }) => {
    const data = parseBook(readData(book.dataFile), {
      workId: work.id, bookNumber: book.number, unitCount: book.unitCount,
    });
    const root = document.createElement("div");
    document.body.append(root);
    window.history.replaceState({}, "", `/#/${work.id}/${book.number}`);
    const fetcher = async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith("catalog.json") ? catalog : data,
    ));
    app = createReaderApp(root, { fetcher, window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelectorAll(".unit")).toHaveLength(data.units.length));

    expect([...root.querySelectorAll<HTMLElement>(".unit")].map((unit) => ({
      id: unit.id,
      en: unit.querySelector(".unit__english")!.textContent,
      ja: unit.querySelector(".unit__japanese")!.textContent,
    }))).toEqual(data.units.map((unit) => ({ id: unit.id, en: unit.en, ja: unit.ja })));
    expect(root.querySelector(".unit__notes")).toBeNull();

    root.querySelector<HTMLButtonElement>('[data-reference-open="notes"]')!.click();
    const entries = [...root.querySelectorAll<HTMLElement>(".reference-note")];
    const notes = data.units.flatMap((unit) => unit.notes.map((note) => ({ unit, note })));
    expect(entries).toHaveLength(notes.length);
    expect(entries.map((entry) => ({
      unit: entry.dataset.noteUnit,
      spoiler: entry.dataset.spoiler,
      titleEn: entry.querySelector(".note__title--english, .note__locale--english .note__locale-title")?.textContent,
      title: entry.querySelector(".note__title--japanese, .note__locale--japanese .note__locale-title")?.textContent,
      bodyEn: entry.querySelector(".note__locale--english .note__locale-body")?.textContent,
      body: entry.querySelector(".note__locale--japanese .note__locale-body")?.textContent,
      sourceUrl: entry.querySelector<HTMLAnchorElement>("a[href^='https://']")?.href ?? null,
    }))).toEqual(notes.map(({ unit, note }) => ({
      unit: unit.id,
      spoiler: String(note.spoiler),
      titleEn: note.titleEn,
      title: note.title,
      bodyEn: note.bodyEn,
      body: note.body,
      sourceUrl: note.sourceUrl ?? null,
    })));

    for (const mode of ["english", "japanese", "bilingual"]) {
      root.querySelector<HTMLButtonElement>(`[role='tab'][data-reading-mode='${mode}']`)!.click();
      const noteDialog = root.querySelector<HTMLDialogElement>('[data-reference-panel="notes"]')!;
      expect(noteDialog.querySelectorAll(".reference-note")).toHaveLength(notes.length);
      for (const entry of entries) {
        expect(entry.querySelector<HTMLElement>(".note__locale--english")!.hidden).toBe(mode === "japanese");
        expect(entry.querySelector<HTMLElement>(".note__locale--japanese")!.hidden).toBe(mode === "english");
      }
      expect([...root.querySelectorAll<HTMLElement>(".unit")].map((unit) => unit.id)).toEqual(data.units.map((unit) => unit.id));
    }
  });
});
