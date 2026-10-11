# SITEMAP

homer-readerの現在のファイル構成と、本文工程で追加予定の構成です。

## 現在のファイル

Issue #1の仕様・受入文書、Issue #3統合計画、読書SPA・テスト・公開設定、統合済み48巻データが存在します。PR CI #2、main CI #3、台帳CI #184は成功し、初回release `r1119-b3`を公開済みです。Issue #9の注釈日英対応結果はIssue #9完了記録、読み上げ変更の受入・公開結果はIssue #11完了記録を参照してください。

| ファイル | 役割 |
| :--- | :--- |
| `README.md` | 概要、現在の状態、予定機能、文書への入口 |
| `SPEC.md` | 要求と出所、読書の流れ、本文・訳・解説の区別、データ契約、出典、品質検証、未決事項（機能・コンテンツ仕様の正本） |
| `ACCEPTANCE.md` | 要求IDに対応する受入条件と追跡表 |
| `PLAN.md` | Issue #3/#4・公開台帳の役割、依存順、検証ゲート、完了条件 |
| `index.html`、`src/` | vanilla TypeScript + Viteの読書SPA、JSON契約、表示、ブラウザー標準読み上げ制御、fixtureテスト |
| `scripts/validate-content.mjs` | 公開前に全48巻と対訳単位を検査するCIゲート |
| `scripts/validate-content.py`、`scripts/import-content.py`、`scripts/translate-content.py` | Butler原文の取込、翻訳キャッシュ・出典manifest・公開本文の再現可能な検証 |
| `tests/content/` | 原文パーサ、翻訳バッチ、公開manifestのfixture検証 |
| `public/fonts/` | IBM Plex Sans JP 400/700のWOFF2、OFLライセンス、出典・checksum |
| `package.json`、`package-lock.json`、`tsconfig.json` | 開発、test、typecheck、buildの再現可能な設定 |
| `src/speech.ts`、`src/speech.test.ts` | SpeechSynthesisの単一発話制御と状態・イベント・停止処理のテスト |
| `.woodpecker.yml`、`static-publish.json`、`scripts/static_publish.py` | PR検査とmainの厳格gate後に静的公開するCI。PR CI #2、main CI #3、台帳CI #184成功。初回release完了。最新の配信結果はIssue #3完了コメントを参照 |
| `SITEMAP.md` | 本ファイル |
| `FLOW.md` | 読書・データ読込・対訳表示・解説表示・コンテンツ整備・公開の流れ |
| `AGENTS.md` | リポジトリ固有の作業契約と検証手順 |

本文データ`public/data/`はIssue #4 PR #7からmainへ統合済みです。98 distinct unitsと別途1単位の抜取確認、6件の限定修正は`CONTENT.md`とcorrection ledgerに記録されています。PR #6、#7、台帳PR #95はマージ済み。初回公開とhash確認は完了し、最新の配信・QA結果はcontrollerがIssue #3完了コメントに記録します。

## 本文データ（後続工程）

| パス | 役割 |
| :--- | :--- |
| `public/data/catalog.json` | 2作品、各24巻、共通出典・生成・対応情報（Issue #4） |
| `public/data/iliad/01.json` など | 1巻ずつの英語本文・日本語訳・解説（Issue #4） |

## 正本の所在

機能・コンテンツ仕様の正本は`SPEC.md`、受入条件の正本は`ACCEPTANCE.md`、実装後のファイル配置の正本は本ファイルです。要求の原文引用は`SPEC.md`の5.1に置き、他文書へ複製しません。
