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
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector(".note__body")?.textContent).not.toContain("bad()");

    const edition = root.querySelector<HTMLDetailsElement>(".edition-details")!;
    expect(edition.open).toBe(false);
    expect(edition.textContent).toContain("AI translation from Butler");
    expect(edition.textContent).toContain("試験用データ。人手確認なし");
    expect(edition.textContent).toContain("英訳の段落単位");
  });

  it("keeps spoiler notes concealed in details until explicitly opened", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector("[data-spoiler='true']")).not.toBeNull());
    const spoiler = root.querySelector<HTMLDetailsElement>('details[data-spoiler="true"]')!;
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

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
