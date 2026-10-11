import type { BookData, Catalog, VoiceSampleManifest } from "./data-contract";

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

export const fixtureVoiceManifest: VoiceSampleManifest = {
  schema: "homer-voice-samples-v1",
  generatedAt: "2026-10-11T08:24:51+00:00",
  provider: "Microsoft Edge online TTS (edge-tts)",
  source: { workId: "iliad", bookNumber: 1, unitId: "iliad-01-0001", reference: "Butler Iliad 1, paragraph 1" },
  texts: { en: "Shared English sample.", ja: "共通の日本語サンプル。" },
  samples: [
    { id: "en-ava", language: "en", label: "Ava", voice: "en-US-AvaMultilingualNeural", rate: "+0%", src: "audio-samples/en-ava.mp3", textSha256: "a".repeat(64), audioSha256: "1".repeat(64), durationSeconds: 23.592 },
    { id: "en-andrew", language: "en", label: "Andrew", voice: "en-US-AndrewMultilingualNeural", rate: "+0%", src: "audio-samples/en-andrew.mp3", textSha256: "a".repeat(64), audioSha256: "2".repeat(64), durationSeconds: 24.648 },
    { id: "ja-nanami", language: "ja", label: "Nanami", voice: "ja-JP-NanamiNeural", rate: "+0%", src: "audio-samples/ja-nanami.mp3", textSha256: "b".repeat(64), audioSha256: "3".repeat(64), durationSeconds: 28.752 },
    { id: "ja-keita", language: "ja", label: "Keita", voice: "ja-JP-KeitaNeural", rate: "+0%", src: "audio-samples/ja-keita.mp3", textSha256: "b".repeat(64), audioSha256: "4".repeat(64), durationSeconds: 24.912 },
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
