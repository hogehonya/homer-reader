import {
  DataContractError,
  parseBook,
  parseCatalog,
  parseRoute,
  parseVoiceManifest,
  type BookData,
  type Catalog,
  type Note,
  type ReaderRoute,
  type VoiceSample,
  type VoiceSampleManifest,
  type WorkIndex,
  type WorkId,
} from "./data-contract";
import { createSpeechController, type SpeechState, type SpeechSynthesisPort, type SpeechUtteranceFactory } from "./speech";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ReaderApp {
  ready: Promise<void>;
  destroy(): void;
}

interface AppOptions {
  fetcher?: Fetcher;
  window?: Window;
  dataRoot?: string;
  speechSynthesis?: SpeechSynthesisPort | null;
  speechUtteranceFactory?: SpeechUtteranceFactory;
}

const KIND_LABELS: Record<Note["kind"], string> = {
  person: "人物",
  place: "地名",
  myth: "神話",
  language: "英語表現",
  interpretation: "解釈",
};

const KIND_LABELS_EN: Record<Note["kind"], string> = {
  person: "Person",
  place: "Place",
  myth: "Myth",
  language: "Language",
  interpretation: "Interpretation",
};

type ReadingMode = "bilingual" | "english" | "japanese";

export function createReaderApp(root: HTMLElement, options: AppOptions = {}): ReaderApp {
  const document = root.ownerDocument;
  const browserCandidate = options.window ?? document.defaultView;
  if (!browserCandidate) throw new Error("A browser window is required to mount the reader");
  const browser: Window = browserCandidate;
  const fetcher = options.fetcher ?? browser.fetch.bind(browser);
  const dataRoot = (options.dataRoot ?? "").replace(/\/$/, "");
  const speechSynthesis = options.speechSynthesis === undefined
    ? getSpeechSynthesis(browser)
    : options.speechSynthesis ?? undefined;
  const audioElements = new Set<HTMLAudioElement>();
  const stopAudioSamples = (clear = false) => {
    for (const audio of audioElements) {
      try {
        audio.pause();
      } catch {
        // Keep teardown moving if a browser media element refuses to pause.
      }
    }
    if (clear) audioElements.clear();
  };
  const speech = createSpeechController(speechSynthesis, options.speechUtteranceFactory ?? getUtteranceFactory(browser), (state) => {
    if (state.activeTarget) stopAudioSamples();
    updateSpeechControls(root, state);
  });
  let catalog: Catalog | undefined;
  let catalogError: string | undefined;
  let routeGeneration = 0;
  let lastHash = browser.location.hash;
  let destroyed = false;

  const render = () => {
    if (destroyed) return;
    if (catalogError) {
      renderCatalogError(root, catalogError, retryCatalog);
      return;
    }
    if (!catalog) {
      renderLoading(root, "作品データを読み込んでいます…");
      return;
    }
    const route = parseRoute(browser.location.hash);
    if (route.kind === "select") {
      renderCatalogPage(root, catalog);
      return;
    }
    if (route.kind === "voices") {
      const generation = ++routeGeneration;
      void loadVoiceSamples(generation);
      return;
    }
    if (route.kind === "invalid") {
      renderInvalidRoute(root, catalog, route.message);
      return;
    }
    const work = catalog.works.find((item) => item.id === route.workId);
    const bookIndex = work?.books.find((item) => item.number === route.bookNumber);
    if (!work || !bookIndex) {
      renderInvalidRoute(root, catalog, "この巻はカタログにありません。作品一覧から選び直してください。");
      return;
    }
    const generation = ++routeGeneration;
    void loadBook(work, bookIndex, route, generation);
  };

  async function loadBook(work: WorkIndex, bookIndex: WorkIndex["books"][number], route: Extract<ReaderRoute, { kind: "book" }>, generation: number) {
    renderBookLoading(root, catalog!, work, bookIndex, route);
    try {
      const response = await fetcher(`${dataRoot}/${bookIndex.dataFile}`);
      if (!response.ok) throw new DataContractError(`HTTP ${response.status}`);
      const raw: unknown = await response.json();
      const book = parseBook(raw, {
        workId: route.workId,
        bookNumber: route.bookNumber,
        unitCount: bookIndex.unitCount,
      });
      if (!isCurrent(generation, route)) return;
      renderBookPage(root, catalog!, work, bookIndex, book, speech);
    } catch {
      if (!isCurrent(generation, route)) return;
      renderBookError(root, catalog!, work, bookIndex, route, () => {
        const retryGeneration = ++routeGeneration;
        void loadBook(work, bookIndex, route, retryGeneration);
      });
    }
  }

  function isCurrent(generation: number, route: Extract<ReaderRoute, { kind: "book" }>) {
    const selected = parseRoute(browser.location.hash);
    return !destroyed && generation === routeGeneration && selected.kind === "book"
      && selected.workId === route.workId && selected.bookNumber === route.bookNumber;
  }

  async function retryCatalog() {
    catalog = undefined;
    catalogError = undefined;
    renderLoading(root, "作品データを読み込んでいます…");
    try {
      const response = await fetcher(`${dataRoot}/data/catalog.json`);
      if (!response.ok) throw new DataContractError(`HTTP ${response.status}`);
      catalog = parseCatalog(await response.json());
      if (!browser.location.hash) setRoute(browser, "iliad", 1, true);
      render();
    } catch {
      catalogError = "作品データを読み込めませんでした。通信状態を確認して、もう一度お試しください。";
      render();
    }
  }

  async function loadVoiceSamples(generation: number) {
    renderVoiceLoading(root, catalog!);
    try {
      const response = await fetcher(`${dataRoot}/audio-samples/manifest.json`);
      if (!response.ok) throw new DataContractError(`HTTP ${response.status}`);
      const manifest = parseVoiceManifest(await response.json());
      if (!isCurrentVoice(generation)) return;
      renderVoiceSamples(root, catalog!, manifest, dataRoot, speech, audioElements);
    } catch {
      if (!isCurrentVoice(generation)) return;
      renderVoiceError(root, catalog!, () => {
        const retryGeneration = ++routeGeneration;
        void loadVoiceSamples(retryGeneration);
      });
    }
  }

  function isCurrentVoice(generation: number) {
    return !destroyed && generation === routeGeneration && parseRoute(browser.location.hash).kind === "voices";
  }

  const onHashChange = () => {
    const currentHash = browser.location.hash;
    if (currentHash === lastHash) return;
    lastHash = currentHash;
    stopAudioSamples(true);
    speech.stop();
    routeGeneration += 1;
    render();
  };
  const onPageHide = () => {
    stopAudioSamples();
    speech.stop();
  };
  browser.addEventListener("hashchange", onHashChange);
  browser.addEventListener("pagehide", onPageHide);
  const ready = retryCatalog();

  return {
    ready,
    destroy() {
      destroyed = true;
      stopAudioSamples(true);
      speech.stop();
      routeGeneration += 1;
      browser.removeEventListener("hashchange", onHashChange);
      browser.removeEventListener("pagehide", onPageHide);
    },
  };
}

function renderLoading(root: HTMLElement, message: string) {
  const main = element(root.ownerDocument, "main", "page-status");
  main.setAttribute("role", "status");
  main.textContent = message;
  root.replaceChildren(main);
}

function renderCatalogError(root: HTMLElement, message: string, retry: () => void) {
  const page = createPage(root.ownerDocument);
  const main = element(root.ownerDocument, "main", "page-status page-status--error");
  main.setAttribute("role", "alert");
  appendText(main, "h1", "作品データを読み込めませんでした");
  appendText(main, "p", message);
  const actions = element(root.ownerDocument, "div", "page-status__actions");
  const retryButton = button(root.ownerDocument, "もう一度読み込む", "retry");
  retryButton.addEventListener("click", retry);
  actions.append(retryButton);
  main.append(actions);
  page.append(main);
  root.replaceChildren(page);
  finishPage(root, "ホメロス読書室 | 作品データの読込エラー");
}

function renderCatalogPage(root: HTMLElement, catalog: Catalog, routeError?: string) {
  const page = createPage(root.ownerDocument, catalog);
  const main = element(root.ownerDocument, "main", "catalog-page");
  main.dataset.view = "catalog";
  appendText(main, "h1", "作品と巻を選ぶ");
  appendText(main, "p", "読みたい作品を選び、巻を開いてください。日本語訳は英語本文と同じ単位で表示します。", "lede");
  if (routeError) {
    const notice = appendText(main, "p", routeError, "route-error");
    notice.setAttribute("role", "alert");
  }
  const works = element(root.ownerDocument, "div", "work-list");
  for (const work of catalog.works) {
    const card = element(root.ownerDocument, "section", "work-card");
    appendText(card, "h2", work.titleJa);
    appendText(card, "p", work.titleEn, "work-card__title-en");
    appendText(card, "p", work.descriptionJa);
    appendText(card, "p", `英訳：${work.source.english.translator}`, "work-card__source");
    appendText(card, "p", `日本語訳：${work.source.japanese.title}（${work.source.japanese.translator}）`, "work-card__source");
    appendText(card, "p", `解説：${work.source.commentary.author}（${work.source.commentary.method}）`, "work-card__source");
    appendText(card, "p", `${work.books.length}巻をカタログに収録`, "work-card__count");
    const volumeList = element(root.ownerDocument, "div", "work-card__volumes");
    for (const book of work.books) {
      const label = book.titleJa ?? `${book.number}巻`;
      volumeList.append(routeLink(root.ownerDocument, label, routeHash(work.id, book.number), "volume-link"));
    }
    card.append(volumeList);
    works.append(card);
  }
  main.append(works);
  page.append(main);
  root.replaceChildren(page);
  finishPage(root, "ホメロス読書室 | 作品と巻を選ぶ");
}

function renderInvalidRoute(root: HTMLElement, catalog: Catalog, message: string) {
  renderCatalogPage(root, catalog, message);
}

function renderVoiceLoading(root: HTMLElement, catalog: Catalog) {
  const page = createPage(root.ownerDocument, catalog);
  const main = element(root.ownerDocument, "main", "voice-page");
  main.dataset.view = "voices";
  appendText(main, "h1", "音声を聴き比べる");
  const status = appendText(main, "p", "試聴データを読み込んでいます…", "page-status");
  status.setAttribute("role", "status");
  page.append(main);
  root.replaceChildren(page);
  finishPage(root, "ホメロス読書室 | 音声を聴き比べる");
}

function renderVoiceError(root: HTMLElement, catalog: Catalog, retry: () => void) {
  const page = createPage(root.ownerDocument, catalog);
  const main = element(root.ownerDocument, "main", "voice-page page-status--error");
  main.dataset.view = "voices";
  appendText(main, "h1", "試聴データを読み込めませんでした");
  const message = appendText(main, "p", "通信状態を確認して、もう一度お試しください。");
  message.setAttribute("role", "alert");
  const actions = element(root.ownerDocument, "div", "page-status__actions");
  const retryButton = button(root.ownerDocument, "試聴データを再読み込み", "voice-retry");
  retryButton.addEventListener("click", retry);
  actions.append(retryButton, routeLink(root.ownerDocument, "読書へ戻る", "#/"));
  main.append(actions);
  page.append(main);
  root.replaceChildren(page);
  finishPage(root, "ホメロス読書室 | 試聴データの読込エラー");
}

function renderVoiceSamples(
  root: HTMLElement,
  catalog: Catalog,
  manifest: VoiceSampleManifest,
  dataRoot: string,
  speech: ReturnType<typeof createSpeechController>,
  audioElements: Set<HTMLAudioElement>,
) {
  const page = createPage(root.ownerDocument, catalog);
  const main = element(root.ownerDocument, "main", "voice-page");
  main.dataset.view = "voices";
  appendText(main, "h1", "音声を聴き比べる");
  appendText(main, "p", "同じ冒頭文の音声サンプルです。実際に聴いて、声の違いをご確認ください。音声は自動再生されません。", "lede");

  const source = element(root.ownerDocument, "section", "voice-source");
  source.setAttribute("aria-labelledby", "voice-source-heading");
  const sourceHeading = appendText(source, "h2", "共通の試聴本文");
  sourceHeading.id = "voice-source-heading";
  appendText(source, "p", `イリアス 第1巻・${manifest.source.reference}（${manifest.source.unitId}）`, "voice-source__reference");
  appendText(source, "p", `生成元: ${manifest.provider}`, "voice-provider");
  const generated = element(root.ownerDocument, "time", "voice-source__generated");
  generated.dateTime = manifest.generatedAt;
  generated.textContent = `生成日時: ${manifest.generatedAt}`;
  source.append(generated);
  main.append(source);

  const groups: Array<{ language: "en" | "ja"; title: string; text: string }> = [
    { language: "ja", title: "日本語音声", text: manifest.texts.ja },
    { language: "en", title: "英語音声", text: manifest.texts.en },
  ];
  for (const group of groups) {
    const section = element(root.ownerDocument, "section", `voice-group voice-group--${group.language}`);
    appendText(section, "h2", group.title);
    const sourceText = appendText(section, "p", group.text, group.language === "en" ? "voice-source--english" : "voice-source--japanese");
    sourceText.lang = group.language;
    const cards = element(root.ownerDocument, "div", "voice-sample-list");
    const samples = manifest.samples.filter((sample) => sample.language === group.language);
    for (const sample of samples) {
      cards.append(renderVoiceSampleCard(root.ownerDocument, sample, dataRoot, speech, audioElements));
    }
    section.append(cards);
    main.append(section);
  }
  const returnLink = routeLink(root.ownerDocument, "読書へ戻る", "#/");
  returnLink.classList.add("voice-return");
  main.append(returnLink);
  page.append(main);
  root.replaceChildren(page);
  finishPage(root, "ホメロス読書室 | 音声を聴き比べる");
}

function renderVoiceSampleCard(
  document: Document,
  sample: VoiceSample,
  dataRoot: string,
  speech: ReturnType<typeof createSpeechController>,
  audioElements: Set<HTMLAudioElement>,
) {
  const card = element(document, "article", "voice-sample-card");
  card.dataset.voiceSample = sample.id;
  appendText(card, "h3", sample.label);
  const metadata = element(document, "dl", "voice-sample-metadata");
  sourceRow(document, metadata, "音声ID", sample.voice);
  sourceRow(document, metadata, "読み上げ速度", sample.rate);
  sourceRow(document, metadata, "音声の長さ", `${sample.durationSeconds.toFixed(3)}秒`);
  card.append(metadata);

  const audio = element(document, "audio", "voice-sample-audio");
  audio.controls = true;
  audio.preload = "none";
  audio.lang = "ja";
  audio.src = `${dataRoot}/${sample.src}`;
  audio.setAttribute("aria-label", `${sample.language === "ja" ? "日本語" : "英語"}サンプル ${sample.label}（${sample.voice}）`);
  const status = appendText(card, "p", "", "voice-sample-status");
  status.dataset.audioStatus = sample.id;
  status.lang = "ja";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  audio.addEventListener("play", () => {
    speech.stop();
    for (const other of audioElements) {
      if (other !== audio) other.pause();
    }
    status.textContent = "再生を開始しています。";
    status.classList.remove("voice-sample-status--error");
  });
  audio.addEventListener("playing", () => { status.textContent = "再生中です。"; });
  audio.addEventListener("pause", () => {
    if (!audio.error) status.textContent = "";
  });
  audio.addEventListener("ended", () => { status.textContent = ""; });
  audio.addEventListener("error", () => {
    status.textContent = "音声を読み込めませんでした。通信状態を確認して、再度お試しください。";
    status.classList.add("voice-sample-status--error");
  });
  audioElements.add(audio);
  card.append(audio);
  return card;
}

function renderBookLoading(root: HTMLElement, catalog: Catalog, work: WorkIndex, bookIndex: WorkIndex["books"][number], route: Extract<ReaderRoute, { kind: "book" }>) {
  const page = createReaderShell(root.ownerDocument, catalog, work, bookIndex, route);
  const status = element(root.ownerDocument, "p", "page-status");
  status.setAttribute("role", "status");
  status.textContent = "巻データを読み込んでいます…";
  page.main.append(status);
  root.replaceChildren(page.element);
}

function renderBookError(root: HTMLElement, catalog: Catalog, work: WorkIndex, bookIndex: WorkIndex["books"][number], route: Extract<ReaderRoute, { kind: "book" }>, retry: () => void) {
  const page = createReaderShell(root.ownerDocument, catalog, work, bookIndex, route);
  const status = element(root.ownerDocument, "section", "page-status page-status--error");
  status.setAttribute("role", "alert");
  appendText(status, "h3", "巻データを読み込めませんでした");
  appendText(status, "p", "データが見つからないか、内容を検証できませんでした。本文は表示していません。");
  const actions = element(root.ownerDocument, "div", "page-status__actions");
  const retryButton = button(root.ownerDocument, "この巻を再試行", "retry");
  retryButton.addEventListener("click", retry);
  actions.append(retryButton, routeLink(root.ownerDocument, "巻選択へ戻る", "#/"));
  status.append(actions);
  page.main.append(status);
  root.replaceChildren(page.element);
  finishPage(root, `ホメロス読書室 | ${work.titleJa} ${bookIndex.titleJa ?? `${bookIndex.number}巻`} の読込エラー`);
}

function renderBookPage(root: HTMLElement, catalog: Catalog, work: WorkIndex, bookIndex: WorkIndex["books"][number], book: BookData, speech: ReturnType<typeof createSpeechController>) {
  const page = createReaderShell(root.ownerDocument, catalog, work, bookIndex, {
    kind: "book", workId: book.workId, bookNumber: book.bookNumber,
  });
  const readingPanelId = `reading-panel-${work.id}-${book.bookNumber}`;
  const readingPanel = element(root.ownerDocument, "div", "reading-panel");
  readingPanel.id = readingPanelId;
  readingPanel.setAttribute("role", "tabpanel");
  const tabControls = renderReadingTabs(root.ownerDocument, readingPanel, speech);
  const units = element(root.ownerDocument, "div", "units");
  book.units.forEach((unit, index) => {
    const article = element(root.ownerDocument, "article", "unit");
    article.id = unit.id;
    article.setAttribute("aria-labelledby", `unit-heading-${index}`);
    const heading = appendText(article, "h3", unit.reference, "unit__reference");
    heading.id = `unit-heading-${index}`;
    const columns = element(root.ownerDocument, "div", "unit__translations");
    const english = element(root.ownerDocument, "section", "translation translation--english");
    english.lang = "en";
    appendText(english, "h4", "English").lang = "en";
    appendText(english, "p", unit.en, "unit__english");
    appendSpeechControl(english, unit.en, `unit:${unit.id}:en`, "en-US", "英語", speech);
    const japanese = element(root.ownerDocument, "section", "translation translation--japanese");
    japanese.lang = "ja";
    appendText(japanese, "h4", "日本語訳");
    appendText(japanese, "p", unit.ja, "unit__japanese");
    appendSpeechControl(japanese, unit.ja, `unit:${unit.id}:ja`, "ja-JP", "日本語", speech);
    columns.append(english, japanese);
    article.append(columns);
    if (unit.notes.length) {
      const notes = element(root.ownerDocument, "section", "unit__notes");
      const notesHeading = element(root.ownerDocument, "h4", "unit__notes-heading");
      appendText(notesHeading, "span", "Notes").lang = "en";
      appendText(notesHeading, "span", "解説").lang = "ja";
      notes.append(notesHeading);
      const list = element(root.ownerDocument, "ul", "note-list");
      unit.notes.forEach((note, noteIndex) => list.append(renderNote(article.ownerDocument, note, unit.id, noteIndex, speech)));
      notes.append(list);
      article.append(notes);
    }
    units.append(article);
  });
  readingPanel.append(units);
  page.main.append(tabControls.tablist, readingPanel, renderEditionDetails(root.ownerDocument, work));
  page.main.append(createAdjacentBookNavigation(root.ownerDocument, work, book.bookNumber));
  tabControls.setMode("bilingual");
  root.replaceChildren(page.element);
  finishPage(root, `ホメロス読書室 | ${work.titleJa} ${bookIndex.titleJa ?? `${book.bookNumber}巻`}`);
}

function renderReadingTabs(document: Document, panel: HTMLElement, speech: ReturnType<typeof createSpeechController>) {
  const panelId = panel.id;
  const modes: Array<{ id: ReadingMode; label: string }> = [
    { id: "bilingual", label: "対訳" },
    { id: "english", label: "英語" },
    { id: "japanese", label: "日本語" },
  ];
  const tablist = element(document, "div", "reading-tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "本文の表示");
  const tabs = modes.map(({ id, label }) => {
    const tab = button(document, label, "reading-tab");
    tab.id = `reading-tab-${id}`;
    tab.dataset.readingMode = id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panelId);
    tablist.append(tab);
    return tab;
  });

  const setMode = (mode: ReadingMode, focus = false) => {
    const selectedIndex = modes.findIndex((item) => item.id === mode);
    for (const [index, tab] of tabs.entries()) {
      const selected = index === selectedIndex;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    const activeTab = tabs[selectedIndex]!;
    panel?.setAttribute("aria-labelledby", activeTab.id);
    if (panel) {
      panel.dataset.readingMode = mode;
      for (const localized of panel.querySelectorAll<HTMLElement>("[lang='en'], [lang='ja']")) {
        localized.hidden = mode !== "bilingual" && localized.lang !== (mode === "english" ? "en" : "ja");
      }
      for (const separator of panel.querySelectorAll<HTMLElement>(".note__separator")) {
        separator.hidden = mode !== "bilingual";
      }
    }
    const activeTarget = speech.getState().activeTarget;
    const hiddenLanguage = mode === "english" ? ":ja" : mode === "japanese" ? ":en" : undefined;
    if (hiddenLanguage && activeTarget?.endsWith(hiddenLanguage)) speech.stop();
    if (focus) activeTab.focus();
  };

  for (const [index, tab] of tabs.entries()) {
    tab.setAttribute("aria-selected", String(index === 0));
    tab.tabIndex = index === 0 ? 0 : -1;
    tab.addEventListener("click", () => setMode(modes[index]!.id));
    tab.addEventListener("keydown", (event) => {
      let nextIndex: number | undefined;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      setMode(modes[nextIndex]!.id, true);
    });
  }
  return { tablist, setMode };
}

function renderNote(document: Document, note: Note, unitId: string, noteIndex: number, speech: ReturnType<typeof createSpeechController>) {
  const item = element(document, "li", "note");
  const details = element(document, "details", "note__details");
  details.dataset.spoiler = String(note.spoiler);
  const summary = element(document, "summary", "note__summary");
  const kind = element(document, "span", "note__kind");
  appendText(kind, "span", KIND_LABELS_EN[note.kind]).lang = "en";
  appendText(kind, "span", " / ", "note__separator").ariaHidden = "true";
  appendText(kind, "span", KIND_LABELS[note.kind]).lang = "ja";
  summary.append(kind);
  if (note.spoiler) {
    const spoilerLabel = element(document, "span", "note__spoiler-label");
    appendText(spoilerLabel, "span", "Spoiler").lang = "en";
    appendText(spoilerLabel, "span", " / ", "note__separator").ariaHidden = "true";
    appendText(spoilerLabel, "span", "ネタバレを含む解説").lang = "ja";
    summary.append(spoilerLabel);
  } else {
    const title = element(document, "span", "note__title");
    appendText(title, "span", note.titleEn, "note__title--english").lang = "en";
    appendText(title, "span", " / ", "note__separator").ariaHidden = "true";
    appendText(title, "span", note.title, "note__title--japanese").lang = "ja";
    summary.append(title);
  }
  const body = element(document, "div", "note__body");
  const noteTarget = `note:${unitId}:${noteIndex}`;
  body.append(renderNoteLocale(document, "english", note.spoiler ? note.titleEn : undefined, note.bodyEn, `${noteTarget}:en`, "en-US", "英語", note.titleEn, details, speech));
  body.append(renderNoteLocale(document, "japanese", note.spoiler ? note.title : undefined, note.body, `${noteTarget}:ja`, "ja-JP", "日本語", note.title, details, speech));
  details.addEventListener("toggle", () => {
    if (!details.open) speech.stopIfTargetStartsWith(`${noteTarget}:`);
  });
  if (note.sourceUrl) {
    const source = element(document, "p", "note__source");
    source.append(makeExternalLink(document, note.sourceUrl, "解説の出典"));
    body.append(source);
  }
  details.append(summary, body);
  item.append(details);
  return item;
}

function renderNoteLocale(document: Document, language: "english" | "japanese", title: string | undefined, body: string, target: string, voiceLocale: "en-US" | "ja-JP", label: string, speechTitle: string, details: HTMLDetailsElement, speech: ReturnType<typeof createSpeechController>) {
  const english = language === "english";
  const locale = element(document, "section", `note__locale note__locale--${language}`);
  locale.lang = english ? "en" : "ja";
  if (title !== undefined) appendText(locale, "h5", title, "note__locale-title");
  appendText(locale, "p", body, "note__locale-body");
  const speechText = voiceLocale === "ja-JP" ? `${speechTitle}。${body}` : `${speechTitle}. ${body}`;
  appendSpeechControl(locale, speechText, target, voiceLocale, label, speech, details);
  return locale;
}

function appendSpeechControl(parent: HTMLElement, text: string, target: string, locale: "en-US" | "ja-JP", label: string, speech: ReturnType<typeof createSpeechController>, disclosure?: HTMLDetailsElement) {
  const controls = element(parent.ownerDocument, "div", "speech-control");
  const control = button(parent.ownerDocument, `${label}を読み上げる`, "speech");
  control.lang = "ja";
  control.dataset.speechLabel = label;
  control.dataset.speechTarget = target;
  control.setAttribute("aria-pressed", "false");
  const status = element(parent.ownerDocument, "span", "speech-status");
  status.dataset.speechStatus = target;
  status.lang = "ja";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.id = `speech-status-${target.replace(/[^a-z0-9-]/gi, "-")}`;
  control.setAttribute("aria-describedby", status.id);
  control.addEventListener("click", () => {
    if (disclosure && !disclosure.open) return;
    speech.toggle(target, text, locale);
  });
  controls.append(control, status);
  parent.append(controls);
}

function updateSpeechControls(root: HTMLElement, state: SpeechState) {
  for (const control of root.querySelectorAll<HTMLButtonElement>("[data-speech-target]")) {
    const target = control.dataset.speechTarget;
    if (!target) continue;
    const active = state.activeTarget === target;
    control.setAttribute("aria-pressed", String(active));
    const label = control.dataset.speechLabel ?? "文章";
    control.textContent = active ? `${label}の読み上げを停止` : `${label}を読み上げる`;
    const status = root.querySelector<HTMLElement>(`#speech-status-${target.replace(/[^a-z0-9-]/gi, "-")}`);
    if (!status) continue;
    status.textContent = state.errorTarget === target
      ? (state.error ?? "")
      : active ? "読み上げ中です。停止するにはボタンを押してください。" : "";
    status.classList.toggle("speech-status--error", state.errorTarget === target);
  }
}

function getSpeechSynthesis(browser: Window): SpeechSynthesisPort | undefined {
  try {
    return "speechSynthesis" in browser ? browser.speechSynthesis : undefined;
  } catch {
    return undefined;
  }
}

function getUtteranceFactory(browser: Window): SpeechUtteranceFactory | undefined {
  try {
    if (!("SpeechSynthesisUtterance" in browser)) return undefined;
    const Constructor = (browser as Window & { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance;
    if (!Constructor) return undefined;
    return (text) => new Constructor(text);
  } catch {
    return undefined;
  }
}

function renderEditionDetails(document: Document, work: WorkIndex) {
  const details = element(document, "details", "edition-details");
  appendText(details, "summary", "この版について");
  const list = element(document, "dl", "source-list");
  sourceRow(document, list, "英語本文", `${work.source.english.title} — ${work.source.english.translator}`);
  sourceRow(document, list, "英訳の出典・利用条件", work.source.english.license, work.source.english.url);
  sourceRow(document, list, "日本語訳", `${work.source.japanese.title} — ${work.source.japanese.translator}`);
  sourceRow(document, list, "日本語訳の利用条件", work.source.japanese.license, work.source.japanese.url);
  sourceRow(document, list, "解説の作成方法", `${work.source.commentary.author}：${work.source.commentary.method}`);
  sourceRow(document, list, "解説の確認範囲", work.source.commentary.reviewScope);
  sourceRow(document, list, "日英の対応", `${work.source.alignment.method}（${work.source.alignment.scope}）`);
  details.append(list);
  return details;
}

function sourceRow(document: Document, list: HTMLDListElement, label: string, value: string, url?: string) {
  appendText(list, "dt", label);
  const description = element(document, "dd");
  description.append(document.createTextNode(value));
  if (url) {
    description.append(document.createTextNode(" — "), makeExternalLink(document, url, "出典を開く"));
  }
  list.append(description);
}

function makeExternalLink(document: Document, url: string, label: string) {
  const link = element(document, "a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function createReaderShell(document: Document, catalog: Catalog, work: WorkIndex, book: WorkIndex["books"][number], route: Extract<ReaderRoute, { kind: "book" }>) {
  const page = createPage(document, catalog);
  const main = element(document, "main", "reader-page");
  main.dataset.view = "reader";
  const heading = element(document, "h1", "reader-page__heading");
  heading.textContent = `${work.titleJa}　${book.titleJa ?? `${book.number}巻`}`;
  const controls = element(document, "nav", "reader-controls");
  controls.setAttribute("aria-label", "作品と巻の移動");
  const back = routeLink(document, "作品・巻を選ぶ", "#/");
  const selectLabel = element(document, "label");
  selectLabel.htmlFor = "book-select";
  selectLabel.textContent = "巻を選ぶ";
  const select = element(document, "select");
  select.id = "book-select";
  for (const entry of work.books) {
    const option = element(document, "option");
    option.value = String(entry.number);
    option.textContent = entry.titleJa ?? `${entry.number}巻`;
    option.selected = entry.number === route.bookNumber;
    select.append(option);
  }
  const browser = document.defaultView;
  if (!browser) throw new Error("A browser window is required to render the reader");
  select.addEventListener("change", () => setRoute(browser, route.workId, Number(select.value)));
  const position = work.books.findIndex((entry) => entry.number === route.bookNumber);
  const previous = work.books[position - 1];
  const next = work.books[position + 1];
  const previousButton = button(document, "前の巻", "previous-book");
  previousButton.disabled = !previous;
  previousButton.addEventListener("click", () => previous && setRoute(browser, route.workId, previous.number));
  const nextButton = button(document, "次の巻", "next-book");
  nextButton.disabled = !next;
  nextButton.addEventListener("click", () => next && setRoute(browser, route.workId, next.number));
  controls.append(back, selectLabel, select, previousButton, nextButton);
  main.append(heading, controls);
  page.append(main);
  return { element: page, main };
}

function createAdjacentBookNavigation(document: Document, work: WorkIndex, bookNumber: number) {
  const navigation = element(document, "nav", "reader-controls reader-continuation");
  navigation.setAttribute("aria-label", "前後の巻へ進む");
  const browser = document.defaultView;
  if (!browser) throw new Error("A browser window is required to render volume navigation");
  const position = work.books.findIndex((entry) => entry.number === bookNumber);
  const previous = work.books[position - 1];
  const next = work.books[position + 1];
  const previousButton = button(document, "前の巻", "previous-book");
  previousButton.disabled = !previous;
  previousButton.addEventListener("click", () => previous && setRoute(browser, work.id, previous.number));
  const nextButton = button(document, "次の巻", "next-book");
  nextButton.disabled = !next;
  nextButton.addEventListener("click", () => next && setRoute(browser, work.id, next.number));
  navigation.append(previousButton, nextButton);
  return navigation;
}

function finishPage(root: HTMLElement, title: string) {
  root.ownerDocument.title = title;
  const heading = root.querySelector<HTMLElement>("main h1");
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}

function createPage(document: Document, catalog?: Catalog) {
  const page = element(document, "div", "app-shell");
  const header = element(document, "header", "app-header");
  const brand = routeLink(document, "ホメロス読書室", "#/", "app-brand");
  header.append(brand);
  if (catalog) {
    const tabs = element(document, "nav", "work-tabs");
    tabs.setAttribute("aria-label", "作品を切り替える");
    for (const work of catalog.works) {
      const link = routeLink(document, work.titleJa, routeHash(work.id, 1), "work-tab");
      link.setAttribute("aria-label", `${work.titleJa}を開く`);
      tabs.append(link);
    }
    header.append(tabs);
    const voiceEntry = routeLink(document, "音声を聴き比べる", "#/voices", "voice-entry");
    voiceEntry.dataset.voiceEntry = "true";
    header.append(voiceEntry);
  }
  page.append(header);
  return page;
}

function element<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function appendText<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const node = element(parent.ownerDocument, tag, className);
  node.textContent = text;
  parent.append(node);
  return node;
}

function button(document: Document, label: string, action: string) {
  const control = element(document, "button", "control");
  control.type = "button";
  control.dataset.action = action;
  control.textContent = label;
  return control;
}

function routeLink(document: Document, label: string, href: string, className = "control") {
  const link = element(document, "a", className);
  link.href = href;
  link.textContent = label;
  return link;
}

function routeHash(workId: WorkId, bookNumber: number) {
  return `#/${workId}/${bookNumber}`;
}

function setRoute(browser: Window, workId: WorkId, bookNumber: number, replace = false) {
  const hash = routeHash(workId, bookNumber);
  if (replace) browser.history.replaceState(browser.history.state, "", `${browser.location.pathname}${browser.location.search}${hash}`);
  else browser.location.hash = hash;
}
