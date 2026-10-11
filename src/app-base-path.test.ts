// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReaderApp, type ReaderApp } from "./app";
import { fixtureBook, fixtureCatalog, fixtureVoiceManifest } from "./fixtures";

describe("reader app base path", () => {
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
  });

  it("prefixes catalog, book, audio manifest, and sample URLs with the Pages base", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("catalog.json")) return jsonResponse(fixtureCatalog);
      if (url.endsWith("manifest.json")) return jsonResponse(fixtureVoiceManifest);
      return jsonResponse(fixtureBook());
    });

    app = createReaderApp(root, { fetcher, window, dataRoot: "/homer-reader/" });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());
    expect(fetcher).toHaveBeenCalledWith("/homer-reader/data/catalog.json");
    expect(fetcher).toHaveBeenCalledWith("/homer-reader/data/iliad/01.json");

    window.location.hash = "#/voices";
    await vi.waitFor(() => expect(root.querySelectorAll(".voice-sample-card")).toHaveLength(4));
    expect(fetcher).toHaveBeenCalledWith("/homer-reader/audio-samples/manifest.json");
    expect(root.querySelector<HTMLAudioElement>("[data-voice-sample='en-ava'] audio")?.getAttribute("src"))
      .toBe("/homer-reader/audio-samples/en-ava.mp3");
  });
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
