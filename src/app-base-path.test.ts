// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReaderApp, type ReaderApp } from "./app";
import { fixtureBook, fixtureCatalog } from "./fixtures";

describe("reader app base path", () => {
  let root: HTMLElement;
  let app: ReaderApp | undefined;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.querySelector<HTMLElement>("#app")!;
    window.history.replaceState({}, "", "/#/iliad/1");
  });
  afterEach(() => { app?.destroy(); app = undefined; });

  it("prefixes reader data with the Pages base while bundled references need no runtime fetch", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith("catalog.json") ? fixtureCatalog : fixtureBook(),
    )));
    app = createReaderApp(root, { fetcher, window, dataRoot: "/homer-reader/" });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());
    expect(fetcher).toHaveBeenCalledWith("/homer-reader/data/catalog.json");
    expect(fetcher).toHaveBeenCalledWith("/homer-reader/data/iliad/01.json");
    root.querySelector<HTMLButtonElement>('[data-reference-open="people"]')!.click();
    expect(root.querySelector("[data-relation-id]")).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
