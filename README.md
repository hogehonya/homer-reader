# homer-reader

ホメロスの『イリアス』と『オデュッセイア』を、ブラウザー上で日英対訳・注釈・読み上げ操作付きで読むSPAです。

## 現在の状態

『イリアス』『オデュッセイア』全48巻を収録しています。初回公開はrelease `r1119-b3`（main commit `c149af861d9f574ee3e4abafcbefcbd0c0621a47`）として完了しました。main CI #3と公開台帳CI #184は成功し、初回配信57ファイルのhashがpublication metadataと一致します。初回配信の検証と公開後QAは[Gitea Issue #3](https://gitea.honya.dev/honya-dev-spa/homer-reader/issues/3)の完了コメントを参照してください。詳細は[PLAN.md](PLAN.md)。

Issue #9の日英注釈対応はPR #10で統合済みです。読み上げ操作の統合受入・CI・公開結果は[Issue #11](https://gitea.honya.dev/honya-dev-spa/homer-reader/issues/11)の最新記録を参照してください。音声比較画面は`#/voices`から開きます。Issue #13のmain反映・CI・公開結果は同Issueの最新記録を参照してください。下記の初回公開証跡はIssue #13の比較画面を含みません。

閲覧URL: https://homer-reader.honya.dev（初回公開でHTTP 200を2026-10-10 17:44:30 JSTに確認）

Gitea repo: [honya-dev-spa/homer-reader](https://gitea.honya.dev/honya-dev-spa/homer-reader)

| 項目 | 状態 |
| :--- | :--- |
| 要求・仕様書 | 作成済み（[SPEC.md](SPEC.md)が機能・コンテンツ仕様の正本） |
| アプリ実装 | 既存1,375注の日英対応はIssue #9 PR #10で統合済み。Issue #11では表示中の本文と開いた注釈に日英の読み上げ操作を追加。Issue #13の変更では`#/voices`に共通原稿の日英音声サンプル比較画面を追加。追加機能の実画面・CI・公開結果は各Issueの最新記録を参照。 |
| 本文・日本語訳・注釈データ | 本文は48巻・2,140対訳単位・英語本文268,999語。全1,375注に英語見出し・本文を追加し、親Agentのbaseline比較で既存日本語注・属性・順序・件数・source manifestの不変を確認。英訳確認の範囲・結果はIssue #9の最新記録を参照。本文・訳の既存抜取確認は98 distinct units / 11,718語と別途1単位、6件の限定修正を記録。全文の人手校閲は未実施。 |
| CI | PR CI #2（[pipeline 2](https://ci.honya.dev/repos/154/pipeline/2)、commit `3ad028b`）は22 UI tests、12 Python tests、Node/Python strict 48-book verificationに成功。main CI #3と公開台帳CI #184も成功。 |
| 公開 | 初回公開release `r1119-b3`を確認。HTTP 200、57配信ファイル全てのhash一致、初回登録後container ID `83485a1a23df505b9300091b8adbd9e0265c704f041eb61b8a54c01ab9ae8ea0`。この証跡はIssue #11・#13の追加機能を含みません。追加公開のQA結果は各Issue完了記録を参照。 |

## 読書の目的

『イリアス』『オデュッセイア』の両方を、作品→巻→本文の順に辿り、英語本文と日本語訳を同じ対訳単位で並べて読み進められる状態を目指します。全巻を読み通せることを達成条件とし、抜粋のみを完成扱いしません。この全巻方針はユーザーの直接指定ではなく、リポジトリ側の実装方針です（[SPEC.md](SPEC.md)のA1）。

## 主な機能

要求IDの詳細はSPEC.mdへ集約しています。

| 機能 | 要求ID |
| :--- | :--- |
| 『イリアス』と『オデュッセイア』の2作品を収録する | R1 |
| 日英の注を付けて読めるようにする | R2、R15 |
| ブラウザで動作するSPAとして提供する | R3、R5 |
| 英語本文と日本語訳を同じ対訳単位で並べる（狭幅は上下） | R4、R8 |
| 作品→巻→本文の順に読めるようにする | R7 |
| 出典・訳者・AI生成有無・確認範囲を確認できるようにする | R12 |
| 本文段落と開いた注釈を日英それぞれ読み上げる | R16 |
| `#/voices`で共通原稿の日本語・英語音声サンプルを比較する | R17 |

検索、公開SPAでの外部TTS API・翻訳API呼出し、全巻向け音声生成、アカウントは追加しません。音声比較には固定の試聴サンプルを使います。読み上げはブラウザー標準SpeechSynthesis APIを利用し、音声の利用可否・品質は端末とブラウザーに依存します。オフライン動作は保証しません。

## 文書

目的に応じて次の文書を参照します。

| 文書 | 内容 |
| :--- | :--- |
| [SPEC.md](SPEC.md) | 要求と出所、読書の流れ、本文・日本語訳・日英の注の区別、データ契約、出典と品質検証、未決事項 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 要求IDに対応する観察可能な受入条件 |
| [PLAN.md](PLAN.md) | Issue #3/#4/#13と公開台帳の役割、依存順、検証・公開ゲート、完了条件 |
| [SITEMAP.md](SITEMAP.md) | 現在と実装予定のファイル構成 |
| [FLOW.md](FLOW.md) | 読書・データ読込・対訳表示・解説表示・コンテンツ整備・公開の流れ |
| [AGENTS.md](AGENTS.md) | リポジトリ固有の作業契約と検証手順 |

## 開発と検証

Node.js 24.15以上とnpmを使います。

```bash
npm ci
npm run dev
npm test
npm run typecheck
npm run build
npm run validate:content:if-present
python3 -m unittest discover -s tests/content -v
python3 scripts/validate-audio-samples.py
# 全48巻のファイルが統合された後に実行する厳格ゲート
python3 scripts/validate-content.py --verify-published
npm run validate:content
```

`npm test`のCLI filesystem regressionは`public/data/catalog.json`を使って欠損巻を再現するため、本文データなしでは成功しません。`typecheck`、`build`、`validate:content:if-present`はデータなしでも実行できます。任意validatorは`public/data`が空のときだけskipし、何か成果物があれば全量を検査します。`validate:content`とPythonの`--verify-published`は48巻を要求する厳格ゲートです。Python parser fixture testsは外部データなしで実行できます。

UIはDADSの読みやすさ・アクセシビリティを基本にし、`IBM Plex Sans JP`を自己ホストします。WebKitGTKで320px表示、両作品の本文表示、マウスによる作品・巻移動、日英横並び、解説の開閉と注釈分類ラベルを確認しました。キーボードではTabフォーカスとEnterによる次巻遷移を確認しています。異常系や履歴移動はfixture検証です。実ブラウザでのdark mode、font fallback、全巻個別閲覧は未確認です。最新の公開後QA証跡はIssue #3完了コメントを参照してください。
