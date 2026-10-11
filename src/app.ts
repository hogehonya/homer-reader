import {
  DataContractError,
  parseBook,
  parseCatalog,
  parseRoute,
  type BookData,
  type Catalog,
  type Note,
  type ReaderRoute,
  type WorkIndex,
  type WorkId,
} from "./data-contract";
import { getCharacterMap, characterMapMetadata } from "./character-data";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ReaderApp {
  ready: Promise<void>;
  destroy(): void;
}

interface AppOptions {
  fetcher?: Fetcher;
  window?: Window;
  dataRoot?: string;
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
      renderBookPage(root, catalog!, work, bookIndex, book);
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

  const onHashChange = () => {
    const currentHash = browser.location.hash;
    if (currentHash === lastHash) return;
    lastHash = currentHash;
    routeGeneration += 1;
    render();
  };
  browser.addEventListener("hashchange", onHashChange);
  const ready = retryCatalog();

  return {
    ready,
    destroy() {
      destroyed = true;
      routeGeneration += 1;
      browser.removeEventListener("hashchange", onHashChange);
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

function renderBookPage(root: HTMLElement, catalog: Catalog, work: WorkIndex, bookIndex: WorkIndex["books"][number], book: BookData) {
  const page = createReaderShell(root.ownerDocument, catalog, work, bookIndex, {
    kind: "book", workId: book.workId, bookNumber: book.bookNumber,
  });
  const readingPanelId = `reading-panel-${work.id}-${book.bookNumber}`;
  const readingPanel = element(root.ownerDocument, "div", "reading-panel");
  readingPanel.id = readingPanelId;
  readingPanel.setAttribute("role", "tabpanel");
  let mode: ReadingMode = "bilingual";
  let syncReferences = () => {};
  const tabControls = renderReadingTabs(root.ownerDocument, readingPanel, (nextMode) => { mode = nextMode; syncReferences(); });
  const languageHeadings = element(root.ownerDocument, "div", "reading-language-headings");
  appendText(languageHeadings, "span", "English").lang = "en";
  appendText(languageHeadings, "span", "日本語訳").lang = "ja";
  const readingOrder = appendText(languageHeadings, "span", "各段落で英語 → 日本語訳の順", "reading-language-order");
  readingOrder.lang = "ja";
  const units = element(root.ownerDocument, "div", "units");
  book.units.forEach((unit, index) => {
    const article = element(root.ownerDocument, "article", "unit");
    article.id = unit.id;
    article.setAttribute("aria-labelledby", `unit-heading-${index}`);
    const heading = appendText(article, "h3", unit.reference, "unit__reference visually-hidden");
    heading.id = `unit-heading-${index}`;
    appendText(article, "span", String(index + 1), "unit__number").setAttribute("aria-hidden", "true");
    const columns = element(root.ownerDocument, "div", "unit__translations");
    const english = element(root.ownerDocument, "section", "translation translation--english");
    english.lang = "en";
    english.setAttribute("aria-label", "English");
    appendText(english, "p", unit.en, "unit__english");
    const japanese = element(root.ownerDocument, "section", "translation translation--japanese");
    japanese.lang = "ja";
    japanese.setAttribute("aria-label", "日本語訳");
    appendText(japanese, "p", unit.ja, "unit__japanese");
    columns.append(english, japanese);
    article.append(columns);
    article.tabIndex = -1;
    units.append(article);
  });
  readingPanel.append(languageHeadings, units);
  const toolbar = renderReferenceToolbar(root.ownerDocument);
  const peopleDialog = renderPeopleDialog(root.ownerDocument, work, book, () => mode, toolbar.peopleButton);
  const notesDialog = renderNotesDialog(root.ownerDocument, book, () => mode, toolbar.notesButton);
  syncReferences = () => { peopleDialog.sync(); notesDialog.sync(); };
  page.main.append(renderEditionDetails(root.ownerDocument, work), tabControls.tablist, toolbar.element, peopleDialog.element, notesDialog.element, readingPanel);
  page.main.append(createAdjacentBookNavigation(root.ownerDocument, work, book.bookNumber));
  tabControls.setMode("bilingual");
  root.replaceChildren(page.element);
  finishPage(root, `ホメロス読書室 | ${work.titleJa} ${bookIndex.titleJa ?? `${book.bookNumber}巻`}`);
}

function renderReadingTabs(document: Document, panel: HTMLElement, onModeChange: (mode: ReadingMode) => void) {
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
    tab.classList.add("reading-tab");
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
      const languageHeadings = panel.querySelector<HTMLElement>(".reading-language-headings");
      if (languageHeadings) languageHeadings.hidden = mode !== "bilingual";
      for (const localized of panel.querySelectorAll<HTMLElement>(".translation")) {
        localized.hidden = mode !== "bilingual" && localized.lang !== (mode === "english" ? "en" : "ja");
      }
    }
    onModeChange(mode);
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

function renderReferenceToolbar(document: Document) {
  const toolbar = element(document, "nav", "reference-toolbar");
  toolbar.setAttribute("aria-label", "本文の参照情報");
  const people = button(document, "人物相関図", "reference-open");
  people.dataset.referenceOpen = "people";
  const notes = button(document, "この巻の用語・解説", "reference-open");
  notes.dataset.referenceOpen = "notes";
  toolbar.append(people, notes);
  return { element: toolbar, peopleButton: people, notesButton: notes };
}

function createReferenceDialog(document: Document, id: string, title: string) {
  const dialog = element(document, "dialog", "reference-dialog");
  dialog.dataset.referencePanel = id;
  dialog.setAttribute("aria-labelledby", `${id}-heading`);
  const header = element(document, "header", "reference-dialog__header");
  const heading = appendText(header, "h2", title);
  heading.id = `${id}-heading`;
  heading.tabIndex = -1;
  const close = button(document, "閉じる", "reference-close");
  close.dataset.referenceClose = "true";
  header.append(close);
  dialog.append(header);
  return { dialog, heading, close };
}

function wireDialog(dialog: HTMLDialogElement, heading: HTMLElement, trigger: HTMLButtonElement) {
  const close = dialog.querySelector<HTMLButtonElement>("[data-reference-close]")!;
  let returnFocus = false;
  const open = () => {
    returnFocus = false;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    heading.focus();
  };
  const dismiss = () => {
    returnFocus = true;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    trigger.focus();
  };
  close.addEventListener("click", dismiss);
  dialog.addEventListener("cancel", () => { returnFocus = true; });
  dialog.addEventListener("close", () => { if (returnFocus) trigger.focus(); });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dismiss();
  });
  trigger.addEventListener("click", open);
  return { open, dismiss };
}

function renderPeopleDialog(document: Document, work: WorkIndex, book: BookData, getMode: () => ReadingMode, trigger: HTMLButtonElement) {
  const { dialog, heading } = createReferenceDialog(document, "people", "人物相関図");
  const map = getCharacterMap(work.id, book.bookNumber);
  const description = appendText(dialog, "p", characterMapMetadata.noticeJa, "reference-notice");
  description.lang = "ja";
  const selectorLabel = element(document, "label");
  selectorLabel.htmlFor = "character-select";
  selectorLabel.textContent = "中心人物";
  const selector = element(document, "select", "reference-select");
  selector.id = "character-select";
  selector.dataset.characterSelect = "true";
  for (const character of map.characters) {
    const option = element(document, "option");
    option.value = character.id;
    option.textContent = getMode() === "english" ? character.nameEn : character.nameJa;
    option.dataset.nameEn = character.nameEn;
    option.dataset.nameJa = character.nameJa;
    selector.append(option);
  }
  const figure = element(document, "section", "relation-map");
  figure.setAttribute("aria-label", "選択人物の関係図。下に同内容のテキスト一覧があります。");
  const center = element(document, "p", "relation-map__center");
  const list = element(document, "ol", "relation-map__list");
  list.setAttribute("aria-label", "人物の関係");
  const empty = appendText(figure, "p", "この巻までに確認できる関係はありません。", "relation-map__empty");
  empty.hidden = true;
  const renderEdges = () => {
    const selectedId = selector.value;
    const mode = getMode();
    const selectedCharacter = map.characters.find((character) => character.id === selectedId)!;
    center.textContent = `${mode === "english" ? selectedCharacter.nameEn : mode === "japanese" ? selectedCharacter.nameJa : `${selectedCharacter.nameEn} / ${selectedCharacter.nameJa}`}（中心人物）`;
    const selectedValue = selector.value;
    const currentNames = map.characters.map((character) => ({ value: character.id, label: mode === "english" ? character.nameEn : character.nameJa }));
    for (const [index, option] of [...selector.options].entries()) {
      const character = map.characters[index]!;
      option.textContent = mode === "bilingual" ? `${character.nameEn} / ${character.nameJa}` : currentNames[index]!.label;
    }
    selector.value = selectedValue;
    const visibleRelations = map.relations.filter((relation) => relation.from === selectedId || relation.to === selectedId);
    list.replaceChildren();
    empty.hidden = visibleRelations.length > 0;
    figure.classList.toggle("relation-map--empty", visibleRelations.length === 0);
    for (const relation of visibleRelations) {
      const from = map.characters.find((item) => item.id === relation.from)!;
      const to = map.characters.find((item) => item.id === relation.to)!;
      const item = element(document, "li", "relation-map__edge");
      item.dataset.relationId = relation.id;
      const name = (character: typeof from) => mode === "english" ? character.nameEn : mode === "japanese" ? character.nameJa : `${character.nameEn} / ${character.nameJa}`;
      const fromNode = element(document, "span", "relation-map__node");
      fromNode.textContent = name(from);
      fromNode.classList.toggle("relation-map__node--selected", from.id === selectedId);
      const connection = element(document, "span", "relation-map__connection");
      const arrow = appendText(connection, "span", "→", "relation-map__arrow");
      arrow.setAttribute("aria-hidden", "true");
      const labelText = mode === "english" ? relation.labelEn : mode === "japanese" ? relation.labelJa : `${relation.labelEn} / ${relation.labelJa}`;
      const label = appendText(connection, "span", labelText, "relation-map__label");
      const endArrow = appendText(connection, "span", "→", "relation-map__arrow");
      endArrow.setAttribute("aria-hidden", "true");
      const toNode = element(document, "span", "relation-map__node");
      toNode.textContent = name(to);
      toNode.classList.toggle("relation-map__node--selected", to.id === selectedId);
      const evidence = element(document, "details", "relation-evidence");
      appendText(evidence, "summary", "根拠と出典");
      const cite = appendText(evidence, "blockquote", `“${relation.evidence.en}”`, "relation-evidence__quote");
      cite.lang = "en";
      const match = /^([a-z]+)-(\d{2})-(\d{4})$/.exec(relation.unitId);
      if (match) {
        const unitBook = Number(match[2]);
        const reference = book.units.find((unit) => unit.id === relation.unitId)?.reference ?? `第${unitBook}巻`;
        const sourceLink = makeExternalLink(document, work.source.english.url, "英語本文の出典");
        appendText(evidence, "p", `${reference}（${relation.unitId}）— この根拠を確認した巻`, "relation-evidence__reference");
        if (unitBook === book.bookNumber) {
          const jump = button(document, "この段落を読む", "reference-jump");
          jump.dataset.referenceUnit = relation.unitId;
          jump.addEventListener("click", () => jumpToUnit(dialog, relation.unitId));
          evidence.append(jump);
        } else {
          const passageLink = routeLink(document, `${work.titleJa} 第${unitBook}巻を開く`, routeHash(work.id, unitBook), "reference-source-route");
          evidence.append(passageLink);
        }
        evidence.append(sourceLink);
      }
      item.append(fromNode, connection, toNode, evidence);
      list.append(item);
    }
  };
  const status = element(document, "p", "visually-hidden");
  status.setAttribute("aria-live", "polite");
  status.textContent = `${map.characters.length}人、${map.relations.length}件の関係を収録しています。`;
  selector.addEventListener("change", renderEdges);
  selector.addEventListener("change", () => {
    status.textContent = `${visibleCount(map, selector.value)}件の関係を表示しています。`;
  });
  figure.append(center, list, empty);
  dialog.append(selectorLabel, selector, status, figure);
  wireDialog(dialog, heading, trigger);
  dialog.dataset.modeSource = "reading-tabs";
  renderEdges();
  return { element: dialog, sync: renderEdges };
}

function visibleCount(map: ReturnType<typeof getCharacterMap>, id: string) {
  return map.relations.filter((relation) => relation.from === id || relation.to === id).length;
}

function renderNotesDialog(document: Document, book: BookData, getMode: () => ReadingMode, trigger: HTMLButtonElement) {
  const { dialog, heading } = createReferenceDialog(document, "notes", "この巻の用語・解説");
  appendText(dialog, "p", "段落ごとの解説をまとめて表示します。ネタバレを含む項目は検索対象に含めません。検索を消すと全項目を表示します。", "reference-notice");
  const searchLabel = element(document, "label");
  searchLabel.htmlFor = "note-search";
  searchLabel.textContent = "見出し・本文を検索";
  const search = element(document, "input", "reference-search");
  search.id = "note-search";
  search.type = "search";
  search.dataset.noteSearch = "true";
  const filterLabel = element(document, "label");
  filterLabel.htmlFor = "note-kind";
  filterLabel.textContent = "種類で絞る";
  const filter = element(document, "select", "reference-select");
  filter.id = "note-kind";
  filter.dataset.noteKind = "true";
  const all = element(document, "option"); all.value = "all"; all.textContent = "すべて"; filter.append(all);
  for (const kind of Object.keys(KIND_LABELS) as Note["kind"][]) {
    const option = element(document, "option"); option.value = kind; option.textContent = KIND_LABELS[kind]; filter.append(option);
  }
  const controls = element(document, "div", "reference-filters");
  controls.append(searchLabel, search, filterLabel, filter);
  const status = appendText(dialog, "p", "", "reference-result-count");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = element(document, "ol", "reference-note-list");
  const rows: Array<{ item: HTMLElement; note: Note; unitId: string; index: number; details: HTMLDetailsElement }> = [];
  for (const unit of book.units) {
    unit.notes.forEach((note, index) => {
      const item = element(document, "li", "reference-note");
      item.dataset.noteUnit = unit.id;
      item.dataset.noteKind = note.kind;
      item.dataset.spoiler = String(note.spoiler);
      const details = element(document, "details", "reference-note__details");
      const summary = element(document, "summary", "note__summary");
      const disclosure = appendText(summary, "span", "▸", "note__disclosure-icon"); disclosure.setAttribute("aria-hidden", "true");
      appendText(summary, "span", kindLabel(note.kind, getMode()), "note__kind");
      if (note.spoiler) {
        appendText(summary, "span", spoilerLabel(getMode()), "note__spoiler-label");
      } else {
        const title = element(document, "span", "note__title");
        const enTitle = appendText(title, "span", note.titleEn, "note__title--english"); enTitle.lang = "en";
        const jaTitle = appendText(title, "span", note.title, "note__title--japanese"); jaTitle.lang = "ja";
        title.dataset.noteTitleEn = note.titleEn;
        title.dataset.noteTitleJa = note.title;
        summary.append(title);
      }
      details.append(summary);
      const body = element(document, "div", "note__body");
      if (note.spoiler) {
        const hidden = element(document, "div", "note__locale note__locale--english"); hidden.lang = "en";
        appendText(hidden, "h3", note.titleEn, "note__locale-title"); appendText(hidden, "p", note.bodyEn, "note__locale-body"); hidden.hidden = getMode() === "japanese";
        const hiddenJa = element(document, "div", "note__locale note__locale--japanese"); hiddenJa.lang = "ja";
        appendText(hiddenJa, "h3", note.title, "note__locale-title"); appendText(hiddenJa, "p", note.body, "note__locale-body"); hiddenJa.hidden = getMode() === "english";
        body.append(hidden, hiddenJa);
      } else {
        const en = element(document, "div", "note__locale note__locale--english"); en.lang = "en";
        appendText(en, "h3", note.titleEn, "note__locale-title"); appendText(en, "p", note.bodyEn, "note__locale-body"); en.hidden = getMode() === "japanese";
        const ja = element(document, "div", "note__locale note__locale--japanese"); ja.lang = "ja";
        appendText(ja, "h3", note.title, "note__locale-title"); appendText(ja, "p", note.body, "note__locale-body"); ja.hidden = getMode() === "english";
        body.append(en, ja);
      }
      const reference = unit.reference;
      appendText(body, "p", `${reference}（${unit.id}）`, "reference-note__reference");
      const jump = button(document, "本文の段落へ", "reference-jump");
      jump.dataset.referenceUnit = unit.id;
      jump.addEventListener("click", () => jumpToUnit(dialog, unit.id));
      body.append(jump);
      if (note.sourceUrl) body.append(makeExternalLink(document, note.sourceUrl, "解説の出典"));
      details.append(body);
      item.append(details);
      list.append(item);
      rows.push({ item, note, unitId: unit.id, index, details });
    });
  }
  const updateRows = () => {
    const mode = getMode();
    const query = search.value.trim().toLocaleLowerCase(mode === "english" ? "en" : "ja");
    let visible = 0;
    for (const row of rows) {
      const { note, item } = row;
      const matchesKind = filter.value === "all" || filter.value === note.kind;
      // Closed spoilers deliberately do not participate in matching or result counts.
      const searchable = note.spoiler ? "" : mode === "english" ? `${note.titleEn} ${note.bodyEn}` : mode === "japanese" ? `${note.title} ${note.body}` : `${note.titleEn} ${note.bodyEn} ${note.title} ${note.body}`;
      const matchesText = !query || (!note.spoiler && searchable.toLocaleLowerCase(mode === "english" ? "en" : "ja").includes(query));
      item.hidden = !(matchesKind && matchesText);
      if (!item.hidden) visible++;
      for (const localized of item.querySelectorAll<HTMLElement>(".note__locale")) {
        localized.hidden = mode !== "bilingual" && localized.lang !== (mode === "english" ? "en" : "ja");
      }
      const title = item.querySelector<HTMLElement>(".note__title");
      if (title) {
        title.querySelector<HTMLElement>(".note__title--english")!.hidden = mode === "japanese";
        title.querySelector<HTMLElement>(".note__title--japanese")!.hidden = mode === "english";
      }
      const kindNode = item.querySelector<HTMLElement>(".note__kind");
      if (kindNode) kindNode.textContent = kindLabel(note.kind, mode);
      const spoilerNode = item.querySelector<HTMLElement>(".note__spoiler-label");
      if (spoilerNode) spoilerNode.textContent = spoilerLabel(mode);
    }
    status.textContent = `${visible}件を表示しています。`;
  };
  search.addEventListener("input", updateRows);
  filter.addEventListener("change", updateRows);
  wireDialog(dialog, heading, trigger);
  dialog.append(controls, status, list);
  updateRows();
  return { element: dialog, sync: updateRows };
}

function jumpToUnit(dialog: HTMLDialogElement, unitId: string) {
  const unit = dialog.ownerDocument.getElementById(unitId);
  const toolbar = unit?.closest(".reader-page")?.querySelector<HTMLElement>(".reference-toolbar");
  const close = dialog.close;
  if (typeof close === "function" && dialog.open) close.call(dialog);
  else dialog.removeAttribute("open");
  if (!unit) return;
  const toolbarHeight = toolbar
    ? Math.max(toolbar.getBoundingClientRect().height, toolbar.offsetHeight)
    : 0;
  unit.style.scrollMarginTop = `${Math.ceil(Math.max(96, toolbarHeight + 16))}px`;
  unit.scrollIntoView?.({ block: "start" });
  unit.focus({ preventScroll: true });
}

function kindLabel(kind: Note["kind"], mode: ReadingMode) {
  return mode === "english" ? KIND_LABELS_EN[kind] : mode === "japanese" ? KIND_LABELS[kind] : `${KIND_LABELS_EN[kind]} / ${KIND_LABELS[kind]}`;
}

function spoilerLabel(mode: ReadingMode) {
  return mode === "english" ? "Spoiler" : mode === "japanese" ? "ネタバレを含む解説" : "Spoiler / ネタバレを含む解説";
}

function renderEditionDetails(document: Document, work: WorkIndex) {
  const details = element(document, "details", "edition-details");
  appendText(details, "summary", "版・出典・翻訳について");
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
