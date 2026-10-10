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
  const units = element(root.ownerDocument, "div", "units");
  book.units.forEach((unit, index) => {
    const article = element(root.ownerDocument, "article", "unit");
    article.setAttribute("aria-labelledby", `unit-heading-${index}`);
    const heading = appendText(article, "h3", unit.reference, "unit__reference");
    heading.id = `unit-heading-${index}`;
    const columns = element(root.ownerDocument, "div", "unit__translations");
    const english = element(root.ownerDocument, "section", "translation translation--english");
    english.lang = "en";
    appendText(english, "h4", "English").lang = "en";
    appendText(english, "p", unit.en, "unit__english");
    const japanese = element(root.ownerDocument, "section", "translation translation--japanese");
    appendText(japanese, "h4", "日本語訳");
    appendText(japanese, "p", unit.ja, "unit__japanese");
    columns.append(english, japanese);
    article.append(columns);
    if (unit.notes.length) {
      const notes = element(root.ownerDocument, "section", "unit__notes");
      appendText(notes, "h4", "解説");
      const list = element(root.ownerDocument, "ul", "note-list");
      unit.notes.forEach((note) => list.append(renderNote(article.ownerDocument, note)));
      notes.append(list);
      article.append(notes);
    }
    units.append(article);
  });
  page.main.append(units, renderEditionDetails(root.ownerDocument, work));
  page.main.append(createAdjacentBookNavigation(root.ownerDocument, work, book.bookNumber));
  root.replaceChildren(page.element);
  finishPage(root, `ホメロス読書室 | ${work.titleJa} ${bookIndex.titleJa ?? `${book.bookNumber}巻`}`);
}

function renderNote(document: Document, note: Note) {
  const item = element(document, "li", "note");
  const details = element(document, "details", "note__details");
  details.dataset.spoiler = String(note.spoiler);
  const summary = element(document, "summary", "note__summary");
  appendText(summary, "span", KIND_LABELS[note.kind], "note__kind");
  if (note.spoiler) appendText(summary, "span", "ネタバレを含む解説", "note__spoiler-label");
  else appendText(summary, "span", note.title, "note__title");
  const body = element(document, "div", "note__body");
  if (note.spoiler) appendText(body, "h5", note.title, "note__title");
  appendText(body, "p", note.body);
  if (note.sourceUrl) {
    const source = element(document, "p", "note__source");
    source.append(makeExternalLink(document, note.sourceUrl, "解説の出典"));
    body.append(source);
  }
  details.append(summary, body);
  item.append(details);
  return item;
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
