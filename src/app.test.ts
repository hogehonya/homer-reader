// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReaderApp, type ReaderApp } from "./app";
import { fixtureBook, fixtureCatalog } from "./fixtures";

describe("reader app", () => {
  let root: HTMLElement;
  let app: ReaderApp | undefined;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>("#app")!;
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    app?.destroy();
    app = undefined;
  });

  it("shows the selected bilingual unit and source metadata using text, not HTML", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("catalog.json")) return jsonResponse(fixtureCatalog);
      return jsonResponse(fixtureBook());
    });
    app = createReaderApp(root, { fetcher, window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());

    expect(window.location.hash).toBe("#/iliad/1");
    expect(root.querySelector(".unit__english")?.textContent).toBe("Sing, goddess.");
    expect(root.querySelector(".translation--english")?.getAttribute("lang")).toBe("en");
    expect(root.querySelector(".unit__japanese")?.textContent).toBe("女神よ、歌いたまえ。");
    expect(root.querySelector(".reference-toolbar")).not.toBeNull();
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector(".unit__notes")).toBeNull();

    const edition = root.querySelector<HTMLDetailsElement>(".edition-details")!;
    expect(edition.open).toBe(false);
    expect(edition.textContent).toContain("AI translation from Butler");
    expect(edition.textContent).toContain("試験用データ。人手確認なし");
    expect(edition.textContent).toContain("英訳の段落単位");
  });

  it("keeps full passage names and language regions while sharing visible language headings", async () => {
    app = createReaderApp(root, { fetcher: twoUnitFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelectorAll(".unit")).toHaveLength(2));
    const units = [...root.querySelectorAll<HTMLElement>(".unit")];
    expect(units.map((unit) => unit.querySelector(".unit__number")?.textContent)).toEqual(["1", "2"]);
    for (const unit of units) {
      const heading = document.getElementById(unit.getAttribute("aria-labelledby")!)!;
      expect(heading.tagName).toBe("H3");
      expect(heading.textContent).toContain("Book 1");
      expect(heading.hidden).toBe(false);
      expect(unit.querySelector(".unit__number")?.getAttribute("aria-hidden")).toBe("true");
      expect(unit.querySelector(".translation--english")?.getAttribute("aria-label")).toBe("English");
      expect(unit.querySelector(".translation--japanese")?.getAttribute("aria-label")).toBe("日本語訳");
      expect(unit.querySelectorAll("h4")).toHaveLength(0);
    }
    const headings = root.querySelector<HTMLElement>(".reading-language-headings")!;
    expect(headings.querySelector("[lang='en']")?.textContent).toBe("English");
    expect(headings.querySelector(".reading-language-order")?.textContent).toBe("各段落で英語 → 日本語訳の順");
    expect(headings.hidden).toBe(false);
    for (const mode of ["english", "japanese"]) {
      root.querySelector<HTMLButtonElement>(`[role='tab'][data-reading-mode='${mode}']`)!.click();
      expect(headings.hidden).toBe(true);
    }
    root.querySelector<HTMLButtonElement>("[role='tab'][data-reading-mode='bilingual']")!.click();
    expect(headings.hidden).toBe(false);
  });

  it("offers edition details before reading and preserves the mode and passage on disclosure", async () => {
    app = createReaderApp(root, { fetcher: twoUnitFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit")).not.toBeNull());
    const edition = root.querySelector<HTMLDetailsElement>(".edition-details")!;
    const panel = root.querySelector<HTMLElement>(".reading-panel")!;
    expect(edition.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(edition.open).toBe(false);
    root.querySelector<HTMLButtonElement>("[data-reading-mode='japanese']")!.click();
    const passage = root.querySelector(".unit__japanese");
    edition.open = true;
    edition.dispatchEvent(new Event("toggle"));
    expect(panel.dataset.readingMode).toBe("japanese");
    expect(root.querySelector(".unit__japanese")).toBe(passage);
  });

  it("supports roving keyboard controls for the three reader tabs", async () => {
    window.history.replaceState({}, "", "/#/odyssey/1");
    app = createReaderApp(root, { fetcher: twoUnitFetcher("odyssey"), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector("[role='tablist']")).not.toBeNull());
    const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role='tab']")];
    tabs[1]!.focus();
    tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
    tabs[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(tabs[2]);
  });

  it("switches every passage and note locale across bilingual, English, and Japanese tabs", async () => {
    window.history.replaceState({}, "", "/#/iliad/1");
    app = createReaderApp(root, { fetcher: twoUnitFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelectorAll(".unit__english")).toHaveLength(2));

    const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role='tab']")];
    const panel = root.querySelector<HTMLElement>("[role='tabpanel']")!;
    expect(tabs.map((tab) => tab.textContent)).toEqual(["対訳", "英語", "日本語"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.every((tab) => tab.getAttribute("aria-controls") === panel.id)).toBe(true);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0]?.id);
    expect(root.querySelectorAll(".translation--english:not([hidden])")).toHaveLength(2);
    expect(root.querySelectorAll(".translation--japanese:not([hidden])")).toHaveLength(2);

    tabs[2]!.click();
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelectorAll(".translation--english[hidden]")).toHaveLength(2);
    expect(root.querySelectorAll(".translation--japanese:not([hidden])")).toHaveLength(2);
    expect(root.querySelector("#iliad-01-0002 .unit__english")?.textContent).toBe("The second passage.");

    root.querySelector<HTMLButtonElement>('[data-reference-open="notes"]')!.click();
    const notesDialog = root.querySelector<HTMLDialogElement>('[data-reference-panel="notes"]')!;
    expect(notesDialog.querySelector(".note__locale--english")?.hasAttribute("hidden")).toBe(true);
    expect(notesDialog.querySelector(".note__locale--japanese")?.hasAttribute("hidden")).toBe(false);

    tabs[1]!.click();
    expect(root.querySelectorAll(".translation--english:not([hidden])")).toHaveLength(2);
    expect(root.querySelectorAll(".translation--japanese[hidden]")).toHaveLength(2);
    expect(notesDialog.querySelector(".note__locale--english")?.hasAttribute("hidden")).toBe(false);
    expect(notesDialog.querySelector(".note__locale--japanese")?.hasAttribute("hidden")).toBe(true);
  });

  it("provides a non-color disclosure cue and keeps the native note and focus on close", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit")).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-reference-open="notes"]')!.click();
    const note = root.querySelector<HTMLDetailsElement>('.reference-note[data-spoiler="false"] details')!;
    const summary = note.querySelector<HTMLElement>("summary")!;
    const cue = summary.querySelector<HTMLElement>(".note__disclosure-icon")!;
    expect(cue).not.toBeNull();
    expect(cue.getAttribute("aria-hidden")).toBe("true");
    const originalText = root.querySelector(".unit__english")!.textContent;
    const originalHash = window.location.hash;
    summary.focus();
    note.open = true;
    note.dispatchEvent(new Event("toggle"));
    note.open = false;
    note.dispatchEvent(new Event("toggle"));
    expect(note.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(root.querySelector(".unit__english")!.textContent).toBe(originalText);
    expect(window.location.hash).toBe(originalHash);
  });

  it("keeps spoiler notes concealed in details until explicitly opened", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit")).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-reference-open="notes"]')!.click();
    const spoiler = root.querySelector<HTMLDetailsElement>('.reference-note[data-spoiler="true"] details')!;
    const body = spoiler.querySelector<HTMLElement>(".note__body")!;

    expect(spoiler.open).toBe(false);
    expect(spoiler.querySelector("summary")?.textContent).not.toContain("パトロクロスの死の伏線");
    expect(spoiler.querySelector("summary")?.textContent).toContain("ネタバレを含む解説");
    expect(body.textContent).toContain("パトロクロスの死の伏線");
    spoiler.querySelector("summary")!.click();
    expect(spoiler.open).toBe(true);
    expect(body.textContent).toContain("<script>bad()</script>");
    expect(body.querySelector("script")).toBeNull();
  });

  it("renders bilingual note labels, titles, and bodies with language metadata", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit")).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-reference-open="notes"]')!.click();

    const note = root.querySelector<HTMLDetailsElement>(".reference-note[data-spoiler='false'] details")!;
    const summary = note.querySelector("summary")!;
    expect(summary.querySelector(".note__kind")?.textContent).toBe("Person / 人物");
    expect(summary.querySelector(".note__title [lang='en']")?.textContent).toBe("Poetic invocation");
    expect(summary.querySelector(".note__title [lang='ja']")?.textContent).toBe("詩の呼びかけ");

    const english = note.querySelector<HTMLElement>(".note__locale--english")!;
    const japanese = note.querySelector<HTMLElement>(".note__locale--japanese")!;
    expect(english.getAttribute("lang")).toBe("en");
    expect(japanese.getAttribute("lang")).toBe("ja");
    expect(english.querySelector("p")?.textContent).toBe("The poet calls upon the goddess to begin the tale.");
    expect(japanese.querySelector("p")?.textContent).toBe("詩人が物語を始めるための言葉です。");
    expect(english.compareDocumentPosition(japanese) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps both spoiler note titles and bodies inside the closed disclosure", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit")).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-reference-open="notes"]')!.click();

    const spoiler = root.querySelector<HTMLDetailsElement>('.reference-note[data-spoiler="true"] details')!;
    const summary = spoiler.querySelector("summary")!;
    expect(spoiler.open).toBe(false);
    expect(summary.querySelector(".note__spoiler-label")?.textContent).toBe("Spoiler / ネタバレを含む解説");
    expect(summary.textContent).not.toContain("Foreshadowing Patroclus's death");
    expect(summary.textContent).not.toContain("パトロクロスの死の伏線");

    const english = spoiler.querySelector<HTMLElement>(".note__locale--english")!;
    const japanese = spoiler.querySelector<HTMLElement>(".note__locale--japanese")!;
    expect(english.querySelector(".note__locale-title")?.textContent).toBe("Foreshadowing Patroclus's death");
    expect(japanese.querySelector(".note__locale-title")?.textContent).toBe("パトロクロスの死の伏線");
    expect(english.querySelector("p")?.textContent).toBe("<script>bad()</script>");
    expect(japanese.querySelector("p")?.textContent).toBe("<script>bad()</script>");
    expect(spoiler.querySelector("script, img, iframe")).toBeNull();
  });

  it("offers retry after a failed volume fetch and renders the recovered data", async () => {
    let attempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("catalog.json")) return jsonResponse(fixtureCatalog);
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      return jsonResponse(fixtureBook());
    });
    app = createReaderApp(root, { fetcher, window });
    await app.ready;
    expect(root.textContent).toContain("巻データを読み込めませんでした");

    root.querySelector<HTMLButtonElement>("[data-action='retry']")!.click();
    await vi.waitFor(() => expect(root.querySelector(".unit__english")?.textContent).toBe("Sing, goddess."));
    expect(attempts).toBe(2);
  });

  it("does not let a slow prior volume overwrite the current selection", async () => {
    let resolveBookOne!: (response: Response) => void;
    const bookOne = new Promise<Response>((resolve) => { resolveBookOne = resolve; });
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("catalog.json")) return Promise.resolve(jsonResponse(fixtureCatalog));
      if (url.endsWith("01.json")) return bookOne;
      return Promise.resolve(jsonResponse(fixtureBook("iliad", 2, "Now the second book.")));
    });
    window.history.replaceState({}, "", "/#/iliad/1");
    app = createReaderApp(root, { fetcher, window });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith("/data/iliad/01.json"));

    window.location.hash = "#/iliad/2";
    await vi.waitFor(() => expect(root.querySelector(".unit__english")?.textContent).toBe("Now the second book."));
    resolveBookOne(jsonResponse(fixtureBook()));
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector(".unit__english")?.textContent).toBe("Now the second book.");
  });

  it("handles browser back/forward and unknown routes without fetching invalid paths", async () => {
    const fetcher = mockedFetcher();
    window.history.replaceState({}, "", "/#/iliad/1");
    app = createReaderApp(root, { fetcher, window });
    await app.ready;

    window.location.hash = "#/odyssey/1";
    await vi.waitFor(() => expect(root.querySelector(".reader-page__heading")?.textContent).toContain("オデュッセイア"));
    window.location.hash = "#/hades/1";
    await vi.waitFor(() => expect(root.textContent).toContain("作品または巻を確認できません"));
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("hades"))).toBe(false);

    window.location.hash = "#/";
    await vi.waitFor(() => expect(root.querySelector("[data-view='catalog']")).not.toBeNull());
    expect(root.textContent).toContain("イリアス");

    window.history.back();
    await vi.waitFor(() => expect(window.location.hash).toBe("#/hades/1"));
    window.history.back();
    await vi.waitFor(() => expect(window.location.hash).toBe("#/odyssey/1"));
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());
    window.history.forward();
    await vi.waitFor(() => expect(window.location.hash).toBe("#/hades/1"));
    window.history.forward();
    await vi.waitFor(() => expect(window.location.hash).toBe("#/"));
  });

  it("shows a catalog error for a valid route whose volume is absent from the catalog", async () => {
    window.history.replaceState({}, "", "/#/iliad/24");
    const fetcher = mockedFetcher();
    app = createReaderApp(root, { fetcher, window });
    await app.ready;

    expect(root.textContent).toContain("この巻はカタログにありません");
    expect(fetcher.mock.calls.some(([input]) => String(input).endsWith("/24.json"))).toBe(false);
  });

  it("focuses the completed page heading and updates the document title on navigation", async () => {
    window.history.replaceState({}, "", "/#/iliad/1");
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());

    const firstHeading = root.querySelector("h1")!;
    expect(firstHeading.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(firstHeading);
    expect(document.title).toContain("イリアス");

    root.querySelector<HTMLButtonElement>("[data-action='next-book']")!.click();
    await vi.waitFor(() => expect(root.querySelector(".reader-page__heading")?.textContent).toContain("第二巻"));
    expect(document.activeElement).toBe(root.querySelector("h1"));
    expect(document.title).toContain("第二巻");

    root.querySelector<HTMLAnchorElement>(".reader-controls a")!.click();
    await vi.waitFor(() => expect(root.querySelector("[data-view='catalog'] h1")).not.toBeNull());
    expect(document.activeElement).toBe(root.querySelector("[data-view='catalog'] h1"));
    expect(document.title).toContain("作品と巻を選ぶ");
  });

  it("shows source origins on the work selection cards", async () => {
    window.history.replaceState({}, "", "/#/");
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;

    const card = root.querySelector(".work-card")!;
    expect(card.textContent).toContain("Samuel Butler");
    expect(card.textContent).toContain("AI日本語訳");
    expect(card.textContent).toContain("AI");
    expect(card.textContent).toContain("短い背景説明を生成");
  });

  it("renders the next-volume control at the end of the reading page", async () => {
    window.history.replaceState({}, "", "/#/iliad/1");
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".edition-details")).not.toBeNull());

    const continuation = root.querySelector<HTMLElement>(".reader-continuation")!;
    expect(continuation.querySelector("[data-action='next-book']")).not.toBeNull();
    continuation.querySelector<HTMLButtonElement>("[data-action='next-book']")!.click();
    await vi.waitFor(() => expect(window.location.hash).toBe("#/iliad/2"));
  });

  it("shows an error instead of rendering a volume with mismatched identity", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("catalog.json")) return jsonResponse(fixtureCatalog);
      return jsonResponse(fixtureBook("odyssey", 1));
    });
    app = createReaderApp(root, { fetcher, window });
    await app.ready;

    await vi.waitFor(() => expect(root.textContent).toContain("巻データを読み込めませんでした"));
    expect(root.querySelector(".unit__english")).toBeNull();
  });

  it("handles malformed book JSON as a failed load", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("catalog.json")) return jsonResponse(fixtureCatalog);
      return new Response("{bad json", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    app = createReaderApp(root, { fetcher, window });
    await app.ready;

    await vi.waitFor(() => expect(root.textContent).toContain("巻データを読み込めませんでした"));
    expect(root.querySelector(".unit__english")).toBeNull();
  });

  it("moves between volumes using the selector and previous/next controls", async () => {
    window.history.replaceState({}, "", "/#/iliad/1");
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());

    root.querySelector<HTMLButtonElement>("[data-action='next-book']")!.click();
    await vi.waitFor(() => expect(window.location.hash).toBe("#/iliad/2"));
    await vi.waitFor(() => expect(root.querySelector<HTMLSelectElement>("#book-select")?.value).toBe("2"));
    await vi.waitFor(() => expect(root.querySelector(".unit__english")?.textContent).toBe("Sing, goddess."));
    root.querySelector<HTMLButtonElement>("[data-action='previous-book']")!.click();
    await vi.waitFor(() => expect(window.location.hash).toBe("#/iliad/1"));
    await vi.waitFor(() => expect(root.querySelector<HTMLSelectElement>("#book-select")?.value).toBe("1"));

    const select = root.querySelector<HTMLSelectElement>("#book-select")!;
    select.value = "2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(window.location.hash).toBe("#/iliad/2"));
  });

  it("shows a catalog error with retry when the catalog is missing", async () => {
    let attempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith("catalog.json")) return jsonResponse(fixtureBook());
      attempts += 1;
      if (attempts === 1) throw new Error("not found");
      return jsonResponse(fixtureCatalog);
    });
    app = createReaderApp(root, { fetcher, window });
    await app.ready;
    expect(root.textContent).toContain("作品データを読み込めませんでした");
    root.querySelector<HTMLButtonElement>("[data-action='retry']")!.click();
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());
    expect(attempts).toBe(2);
  });

});

function mockedFetcher() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("catalog.json")) return jsonResponse(fixtureCatalog);
    const [, workId, file] = url.match(/data\/(iliad|odyssey)\/(\d+)\.json$/) ?? [];
    if (!workId || !file) return new Response("missing", { status: 404 });
    const number = Number(file);
    return jsonResponse(fixtureBook(workId as "iliad" | "odyssey", number));
  });
}

function twoUnitFetcher(workId: "iliad" | "odyssey" = "iliad") {
  const book = fixtureBook(workId);
  const catalog = structuredClone(fixtureCatalog);
  catalog.works.find((work) => work.id === workId)!.books[0]!.unitCount = 2;
  const first = book.units[0]!;
  book.units.push({
    ...first,
    id: `${workId}-01-0002`,
    reference: "Book 1, paragraph 2",
    en: "The second passage.",
    ja: "第二の段落です。",
    notes: [],
  });
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("catalog.json")) return jsonResponse(catalog);
    return jsonResponse(book);
  });
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
