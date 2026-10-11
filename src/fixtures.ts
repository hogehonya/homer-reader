import type { BookData, Catalog } from "./data-contract";

export const fixtureCatalog: Catalog = {
  version: 1,
  works: [
    {
      id: "iliad",
      titleJa: "イリアス",
      titleEn: "Iliad",
      descriptionJa: "試験用の短い説明です。",
      books: [
        { number: 1, titleJa: "第一巻", unitCount: 1, dataFile: "data/iliad/01.json" },
        { number: 2, titleJa: "第二巻", unitCount: 1, dataFile: "data/iliad/02.json" },
      ],
      source: {
        english: {
          title: "Iliad",
          translator: "Samuel Butler",
          url: "https://example.test/iliad",
          license: "検証用ライセンス表記",
        },
        japanese: {
          title: "AI日本語訳",
          translator: "AI translation from Butler",
          license: "生成した試験用テキスト",
        },
        commentary: {
          author: "AI",
          method: "短い背景説明を生成",
          reviewScope: "試験用データ。人手確認なし",
        },
        alignment: { method: "英訳の段落単位", scope: "この試験データ1件" },
      },
    },
    {
      id: "odyssey",
      titleJa: "オデュッセイア",
      titleEn: "Odyssey",
      descriptionJa: "試験用の短い説明です。",
      books: [
        { number: 1, titleJa: "第一巻", unitCount: 1, dataFile: "data/odyssey/01.json" },
      ],
      source: {
        english: {
          title: "Odyssey",
          translator: "Samuel Butler",
          url: "https://example.test/odyssey",
          license: "検証用ライセンス表記",
        },
        japanese: {
          title: "AI日本語訳",
          translator: "AI translation from Butler",
          license: "生成した試験用テキスト",
        },
        commentary: {
          author: "AI",
          method: "短い背景説明を生成",
          reviewScope: "試験用データ。人手確認なし",
        },
        alignment: { method: "英訳の段落単位", scope: "この試験データ1件" },
      },
    },
  ],
};

export function fixtureBook(workId: BookData["workId"] = "iliad", bookNumber = 1, english = "Sing, goddess."): BookData {
  return {
    workId,
    bookNumber,
    units: [
      {
        id: `${workId}-${String(bookNumber).padStart(2, "0")}-0001`,
        reference: `Book ${bookNumber}, paragraph 1`,
        en: english,
        ja: "女神よ、歌いたまえ。",
        notes: [
          {
            kind: "person",
            title: "詩の呼びかけ",
            titleEn: "Poetic invocation",
            body: "詩人が物語を始めるための言葉です。",
            bodyEn: "The poet calls upon the goddess to begin the tale.",
            spoiler: false,
          },
          {
            kind: "interpretation",
            title: "パトロクロスの死の伏線",
            titleEn: "Foreshadowing Patroclus's death",
            body: "<script>bad()</script>",
            bodyEn: "<script>bad()</script>",
            spoiler: true,
          },
        ],
      },
    ],
  };
}
