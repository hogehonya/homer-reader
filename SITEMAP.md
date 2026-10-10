# SITEMAP

homer-readerの現在のファイル構成と、本文工程で追加予定の構成です。

## 現在のファイル

Issue #1の仕様・受入文書、Issue #3統合計画、読書SPA・テスト・公開設定が存在します。本文48巻の統合・CI実行・公開は未完了です。

| ファイル | 役割 |
| :--- | :--- |
| `README.md` | 概要、現在の状態、予定機能、文書への入口 |
| `SPEC.md` | 要求と出所、読書の流れ、本文・訳・解説の区別、データ契約、出典、品質検証、未決事項（機能・コンテンツ仕様の正本） |
| `ACCEPTANCE.md` | 要求IDに対応する受入条件と追跡表 |
| `PLAN.md` | Issue #3/#4・公開台帳の役割、依存順、検証ゲート、完了条件 |
| `index.html`、`src/` | vanilla TypeScript + Viteの読書SPA、JSON契約、表示、fixtureテスト |
| `scripts/validate-content.mjs` | 公開前に全48巻と対訳単位を検査するCIゲート |
| `public/fonts/` | IBM Plex Sans JP 400/700のWOFF2、OFLライセンス、出典・checksum |
| `package.json`、`package-lock.json`、`tsconfig.json` | 開発、test、typecheck、buildの再現可能な設定 |
| `.woodpecker.yml`、`static-publish.json`、`scripts/static_publish.py` | 品質gate後の静的公開CI（未実行） |
| `SITEMAP.md` | 本ファイル |
| `FLOW.md` | 読書・データ読込・対訳表示・解説表示・コンテンツ整備・公開の流れ |
| `AGENTS.md` | リポジトリ固有の作業契約と検証手順 |

本文データ`public/data/`は別Issue #4で整備中です。CIと公開はこのbranchで設定し、mainへの反映・実行はcontrollerが統合します。

## 本文データ（後続工程）

| パス | 役割 |
| :--- | :--- |
| `public/data/catalog.json` | 2作品、各24巻、共通出典・生成・対応情報（Issue #4） |
| `public/data/iliad/01.json` など | 1巻ずつの英語本文・日本語訳・解説（Issue #4） |

## 正本の所在

機能・コンテンツ仕様の正本は`SPEC.md`、受入条件の正本は`ACCEPTANCE.md`、実装後のファイル配置の正本は本ファイルです。要求の原文引用は`SPEC.md`の5.1に置き、他文書へ複製しません。
