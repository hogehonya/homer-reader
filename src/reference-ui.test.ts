// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReaderApp, type ReaderApp } from "./app";
import { fixtureBook, fixtureCatalog } from "./fixtures";

describe("reader reference panels", () => {
  let root: HTMLElement;
  let app: ReaderApp | undefined;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>("#app")!;
    window.history.replaceState({}, "", "/#/iliad/1");
  });

  afterEach(() => {
    app?.destroy();
    app = undefined;
    document.body.replaceChildren();
  });

  it("keeps the bilingual reader and opens a modal people map with directed source evidence", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());
    expect(root.querySelector(".unit__english")?.textContent).toBe("Sing, goddess.");
    expect(root.querySelector(".unit__japanese")?.textContent).toBe("女神よ、歌いたまえ。");
    expect(root.querySelector("[data-speech-target], [data-voice-entry], .unit__notes")).toBeNull();

    const opener = root.querySelector<HTMLButtonElement>('[data-reference-open="people"]')!;
    opener.focus();
    opener.click();
    const dialog = root.querySelector<HTMLDialogElement>('[data-reference-panel="people"]')!;
    expect(dialog.open).toBe(true);
    expect(document.activeElement?.id).toBe("people-heading");
    expect(dialog.querySelector("[data-character-select] option[value='achilles']")).not.toBeNull();
    expect(dialog.querySelector("[data-character-select] option[value='paris']")).toBeNull();
    const edge = dialog.querySelector<HTMLElement>("[data-relation-id='iliad-achilles-peleus']")!;
    expect(edge.textContent).toContain("アキレウス");
    expect(edge.textContent).toContain("息子 → 父");
    expect(edge.textContent).toContain("ペーレウス");
    expect(edge.querySelector("blockquote")?.textContent).toContain("Achilles son of Peleus");
    expect(edge.querySelector("[data-reference-unit='iliad-01-0001']")).not.toBeNull();
    expect(edge.querySelector("a[href='https://example.test/iliad']")).not.toBeNull();

    const selector = dialog.querySelector<HTMLSelectElement>("[data-character-select]")!;
    selector.value = "peleus";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    const selectedEdge = dialog.querySelector<HTMLElement>("[data-relation-id='iliad-achilles-peleus']")!;
    expect(selectedEdge.querySelector(".relation-map__node--selected")?.textContent).toContain("ペーレウス");
    expect(selectedEdge.textContent).toContain("アキレウス");
    expect(selectedEdge.textContent).toContain("息子 → 父");
    expect(selectedEdge.textContent).toContain("ペーレウス");
  });

  it("lists all current-volume notes, searches only visible non-spoiler text, and jumps without changing the route", async () => {
    const book = fixtureBook();
    const second = { ...book.units[0]!, id: "iliad-01-0002", reference: "Book 1, paragraph 2", notes: [] };
    book.units.push(second);
    app = createReaderApp(root, { fetcher: mockedFetcher(book), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelectorAll(".unit")).toHaveLength(2));
    const route = window.location.hash;
    root.querySelector<HTMLButtonElement>('[data-reference-open="notes"]')!.click();
    const dialog = root.querySelector<HTMLDialogElement>('[data-reference-panel="notes"]')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelectorAll(".reference-note")).toHaveLength(2);
    const spoiler = dialog.querySelector<HTMLElement>('[data-spoiler="true"]')!;
    expect(spoiler.querySelector("summary")?.textContent).toContain("ネタバレを含む解説");
    expect(spoiler.querySelector("summary")?.textContent).not.toContain("パトロクロスの死");

    const search = dialog.querySelector<HTMLInputElement>("[data-note-search]")!;
    search.value = "パトロクロスの死";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dialog.querySelector("[data-spoiler='true']")?.hasAttribute("hidden")).toBe(true);
    expect(dialog.querySelector<HTMLElement>("[data-spoiler='true']")?.hidden).toBe(true);
    expect(dialog.querySelector("[role='status']")?.textContent).toContain("0件");

    search.value = "poetic";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dialog.querySelectorAll(".reference-note:not([hidden])")).toHaveLength(1);
    dialog.querySelector<HTMLSelectElement>("[data-note-kind]")!.value = "person";
    dialog.querySelector<HTMLSelectElement>("[data-note-kind]")!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(dialog.querySelectorAll(".reference-note:not([hidden])")).toHaveLength(1);
    const jump = dialog.querySelector<HTMLButtonElement>("[data-reference-unit='iliad-01-0001']")!;
    jump.click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement?.id).toBe("iliad-01-0001");
    expect(window.location.hash).toBe(route);
  });

  it("follows the reader language mode and returns focus when the panel closes", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit")).not.toBeNull());
    root.querySelector<HTMLButtonElement>("[data-reading-mode='english']")!.click();
    const opener = root.querySelector<HTMLButtonElement>('[data-reference-open="notes"]')!;
    opener.click();
    const dialog = root.querySelector<HTMLDialogElement>('[data-reference-panel="notes"]')!;
    const note = dialog.querySelector<HTMLElement>(".reference-note:not([hidden])")!;
    expect(note.querySelector(".note__locale--english")?.hasAttribute("hidden")).toBe(false);
    expect(note.querySelector(".note__locale--japanese")?.hasAttribute("hidden")).toBe(true);
    dialog.querySelector<HTMLButtonElement>("[data-reference-close]")!.click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to the opener when a native dialog is cancelled", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit")).not.toBeNull());
    const opener = root.querySelector<HTMLButtonElement>('[data-reference-open="people"]')!;
    opener.click();
    const dialog = root.querySelector<HTMLDialogElement>('[data-reference-panel="people"]')!;
    dialog.dispatchEvent(new Event("cancel", { bubbles: false }));
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
    expect(document.activeElement).toBe(opener);
  });

  it("renders an unknown voice URL as an invalid route without loading audio", async () => {
    window.history.replaceState({}, "", "/#/voices");
    const fetcher = mockedFetcher();
    app = createReaderApp(root, { fetcher, window });
    await app.ready;
    expect(root.querySelector("[data-view='catalog'] .route-error")?.textContent).toContain("作品または巻");
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining("audio-samples"));
    expect(root.querySelector("audio, [data-voice-entry]")).toBeNull();
  });
});

function mockedFetcher(book = fixtureBook()) {
  const catalog = structuredClone(fixtureCatalog);
  const selectedWork = catalog.works.find((work) => work.id === book.workId)!;
  selectedWork.books.find((entry) => entry.number === book.bookNumber)!.unitCount = book.units.length;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("catalog.json")) return jsonResponse(catalog);
    return jsonResponse(book);
  });
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}
