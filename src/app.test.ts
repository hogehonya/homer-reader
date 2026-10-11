// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReaderApp, type ReaderApp } from "./app";
import { fixtureBook, fixtureCatalog, fixtureVoiceManifest } from "./fixtures";
import type { SpeechSynthesisPort } from "./speech";

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
    expect(root.querySelector(".unit__notes-heading [lang='en']")?.textContent).toBe("Notes");
    expect(root.querySelector(".unit__notes-heading [lang='ja']")?.textContent).toBe("解説");
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

  it("renders bilingual note labels, titles, and bodies with language metadata", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".note")).not.toBeNull());

    const note = root.querySelector<HTMLElement>("details[data-spoiler='false']")!;
    const summary = note.querySelector("summary")!;
    expect(summary.querySelector(".note__kind [lang='en']")?.textContent).toBe("Person");
    expect(summary.querySelector(".note__kind [lang='ja']")?.textContent).toBe("人物");
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
    await vi.waitFor(() => expect(root.querySelector("details[data-spoiler='true']")).not.toBeNull());

    const spoiler = root.querySelector<HTMLDetailsElement>('details[data-spoiler="true"]')!;
    const summary = spoiler.querySelector("summary")!;
    expect(spoiler.open).toBe(false);
    expect(summary.querySelector(".note__spoiler-label [lang='en']")?.textContent).toBe("Spoiler");
    expect(summary.querySelector(".note__spoiler-label [lang='ja']")?.textContent).toBe("ネタバレを含む解説");
    expect(summary.textContent).not.toContain("Foreshadowing Patroclus's death");
    expect(summary.textContent).not.toContain("パトロクロスの死の伏線");

    const english = spoiler.querySelector<HTMLElement>(".note__locale--english")!;
    const japanese = spoiler.querySelector<HTMLElement>(".note__locale--japanese")!;
    expect(english.querySelector("h5")?.textContent).toBe("Foreshadowing Patroclus's death");
    expect(japanese.querySelector("h5")?.textContent).toBe("パトロクロスの死の伏線");
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

  it("opens the voice comparison directly and shows the shared bilingual source and native controls", async () => {
    window.history.replaceState({}, "", "/#/voices");
    const fetcher = voiceMockedFetcher();
    app = createReaderApp(root, { fetcher, window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelectorAll(".voice-sample-card")).toHaveLength(4));

    expect(window.location.hash).toBe("#/voices");
    expect(fetcher).toHaveBeenCalledWith("/audio-samples/manifest.json");
    expect(root.querySelector("[data-view='voices'] h1")?.textContent).toBe("音声を聴き比べる");
    expect(root.querySelector(".voice-source--english")?.textContent).toContain("Shared English sample.");
    expect(root.querySelector(".voice-source--japanese")?.textContent).toContain("共通の日本語サンプル。");
    expect(root.querySelector(".voice-provider")?.textContent).toContain("Microsoft Edge online TTS");
    expect(root.querySelector("[data-voice-sample='en-ava']")?.textContent).toContain("en-US-AvaMultilingualNeural");

    const audios = root.querySelectorAll<HTMLAudioElement>(".voice-sample-card audio");
    expect(audios).toHaveLength(4);
    const ava = root.querySelector<HTMLAudioElement>("[data-voice-sample='en-ava'] audio")!;
    expect(ava.controls).toBe(true);
    expect(ava.preload).toBe("none");
    expect(ava.hasAttribute("autoplay")).toBe(false);
    expect(ava.getAttribute("src")).toBe("/audio-samples/en-ava.mp3");
    expect(root.querySelector("[data-voice-entry]")?.getAttribute("href")).toBe("#/voices");
  });

  it("allows one sample at a time and stops all samples on pagehide and route change", async () => {
    window.history.replaceState({}, "", "/#/voices");
    const fetcher = voiceMockedFetcher();
    app = createReaderApp(root, { fetcher, window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelectorAll(".voice-sample-card audio")).toHaveLength(4));

    const paused = new Set<HTMLMediaElement>();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      paused.add(this);
    });
    const audio = (id: string) => root.querySelector<HTMLAudioElement>(`[data-voice-sample='${id}'] audio`)!;
    const ava = audio("en-ava");
    const andrew = audio("en-andrew");
    const nanami = audio("ja-nanami");
    const keita = audio("ja-keita");
    ava.dispatchEvent(new Event("play"));
    paused.clear();
    andrew.dispatchEvent(new Event("play"));
    andrew.dispatchEvent(new Event("playing"));
    expect(paused.has(ava)).toBe(true);
    expect(paused.has(andrew)).toBe(false);
    expect(root.querySelector<HTMLElement>("[data-audio-status='en-andrew']")?.textContent).toContain("再生中");

    nanami.dispatchEvent(new Event("error"));
    expect(root.querySelector<HTMLElement>("[data-audio-status='ja-nanami']")?.textContent).toContain("再度お試し");

    window.dispatchEvent(new Event("pagehide"));
    expect(paused.has(andrew)).toBe(true);
    expect(paused.has(nanami)).toBe(true);

    paused.clear();
    keita.dispatchEvent(new Event("play"));
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
    expect(paused.has(keita)).toBe(true);
  });

  it("renders manifest text as text rather than markup", async () => {
    window.history.replaceState({}, "", "/#/voices");
    const manifest = structuredClone(fixtureVoiceManifest);
    manifest.texts.en = "<img src=x onerror=alert(1)>";
    app = createReaderApp(root, { fetcher: voiceMockedFetcher(manifest), window });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".voice-source--english")).not.toBeNull());

    expect(root.querySelector(".voice-source--english")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(root.querySelector(".voice-source--english img")).toBeNull();
  });

  it("reports a missing manifest with a retry path rather than inventing samples", async () => {
    window.history.replaceState({}, "", "/#/voices");
    let attempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("catalog.json")) return jsonResponse(fixtureCatalog);
      if (String(input).endsWith("manifest.json")) {
        attempts += 1;
        return attempts === 1 ? new Response("missing", { status: 404 }) : jsonResponse(fixtureVoiceManifest);
      }
      return jsonResponse(fixtureBook());
    });
    app = createReaderApp(root, { fetcher, window });
    await app.ready;
    await vi.waitFor(() => expect(root.textContent).toContain("試聴データを読み込めませんでした"));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(root.querySelector(".voice-sample-card")).toBeNull();
    const attemptsBeforeRetry = attempts;

    root.querySelector<HTMLButtonElement>("[data-action='voice-retry']")!.click();
    await vi.waitFor(() => expect(root.querySelectorAll(".voice-sample-card")).toHaveLength(4));
    expect(attempts).toBeGreaterThan(attemptsBeforeRetry);
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

  it("adds full-text English and Japanese speech controls and keeps only one target active", async () => {
    const speech = speechHarness();
    window.history.replaceState({}, "", "/#/iliad/1");
    app = createReaderApp(root, { fetcher: mockedFetcher(), window, ...speech.options });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());

    const speechButtons = root.querySelectorAll<HTMLButtonElement>("[data-speech-target^='unit:iliad-01-0001']");
    const englishButton = speechButtons[0]!;
    const japaneseButton = speechButtons[1]!;
    englishButton.click();
    expect(speech.utterances[0]?.text).toBe("Sing, goddess.");
    expect(speech.utterances[0]?.lang).toBe("en-US");
    expect(englishButton.getAttribute("aria-pressed")).toBe("true");
    expect(englishButton.lang).toBe("ja");
    expect(englishButton.textContent).toBe("英語の読み上げを停止");

    japaneseButton.click();
    expect(speech.engine.cancel).toHaveBeenCalledTimes(1);
    expect(speech.utterances[1]?.text).toBe("女神よ、歌いたまえ。");
    expect(speech.utterances[1]?.lang).toBe("ja-JP");
    expect(englishButton.getAttribute("aria-pressed")).toBe("false");
    expect(englishButton.textContent).toBe("英語を読み上げる");
    expect(japaneseButton.getAttribute("aria-pressed")).toBe("true");
  });

  it("speaks notes only while their own disclosure is open and stops when it closes", async () => {
    const speech = speechHarness();
    app = createReaderApp(root, { fetcher: mockedFetcher(), window, ...speech.options });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".note")).not.toBeNull());
    const note = root.querySelector<HTMLDetailsElement>('details[data-spoiler="false"]')!;
    const button = note.querySelector<HTMLButtonElement>('.note__locale--english [data-speech-target]')!;

    button.click();
    expect(speech.engine.speak).not.toHaveBeenCalled();

    note.open = true;
    note.dispatchEvent(new Event("toggle"));
    button.click();
    expect(speech.utterances[0]?.text).toBe("Poetic invocation. The poet calls upon the goddess to begin the tale.");
    expect(speech.utterances[0]?.lang).toBe("en-US");

    const japaneseButton = note.querySelector<HTMLButtonElement>('.note__locale--japanese [data-speech-target]')!;
    japaneseButton.click();
    expect(speech.engine.cancel).toHaveBeenCalledTimes(1);
    expect(speech.utterances[1]?.text).toBe("詩の呼びかけ。詩人が物語を始めるための言葉です。");
    expect(speech.utterances[1]?.lang).toBe("ja-JP");

    note.open = false;
    note.dispatchEvent(new Event("toggle"));
    expect(speech.engine.cancel).toHaveBeenCalledTimes(2);
    expect(japaneseButton.getAttribute("aria-pressed")).toBe("false");
  });

  it.each(["hashchange", "pagehide"])("stops speech on %s", async (eventName) => {
    const speech = speechHarness();
    app = createReaderApp(root, { fetcher: mockedFetcher(), window, ...speech.options });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector("[data-speech-target]")).not.toBeNull());
    root.querySelector<HTMLButtonElement>("[data-speech-target]")!.click();
    window.dispatchEvent(new Event(eventName));
    expect(speech.engine.cancel).toHaveBeenCalledTimes(1);
  });

  it("stops speech when the app is destroyed", async () => {
    const speech = speechHarness();
    app = createReaderApp(root, { fetcher: mockedFetcher(), window, ...speech.options });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector("[data-speech-target]")).not.toBeNull());
    root.querySelector<HTMLButtonElement>("[data-speech-target]")!.click();
    app.destroy();
    expect(speech.engine.cancel).toHaveBeenCalledTimes(1);
    app = undefined;
  });

  it("explains unavailable speech without hiding reader text", async () => {
    app = createReaderApp(root, { fetcher: mockedFetcher(), window, speechSynthesis: null });
    await app.ready;
    await vi.waitFor(() => expect(root.querySelector(".unit__english")).not.toBeNull());
    root.querySelector<HTMLButtonElement>("[data-speech-target]")!.click();
    expect(root.querySelector(".unit__english")?.textContent).toBe("Sing, goddess.");
    expect(root.querySelector('[role="status"]')?.textContent).toContain("対応していません");
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

function voiceMockedFetcher(manifest = fixtureVoiceManifest) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("catalog.json")) return jsonResponse(fixtureCatalog);
    if (url.endsWith("audio-samples/manifest.json")) return jsonResponse(manifest);
    const [, workId, file] = url.match(/data\/(iliad|odyssey)\/(\d+)\.json$/) ?? [];
    if (!workId || !file) return new Response("missing", { status: 404 });
    return jsonResponse(fixtureBook(workId as "iliad" | "odyssey", Number(file)));
  });
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function speechHarness() {
  const utterances: Array<{ text: string; lang: string; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null }> = [];
  const engine: SpeechSynthesisPort = { speak: vi.fn(), cancel: vi.fn() };
  const speechUtteranceFactory = vi.fn((text: string) => {
    const utterance = { text, lang: "", onend: null, onerror: null };
    utterances.push(utterance);
    return utterance as unknown as SpeechSynthesisUtterance;
  });
  return { options: { speechSynthesis: engine, speechUtteranceFactory }, engine, utterances };
}
