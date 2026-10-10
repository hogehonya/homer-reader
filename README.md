# homer-reader

ホメロスの『イリアス』と『オデュッセイア』を、ブラウザ上で日英対訳・日本語解説付きで読むSPAです。

## 現在の状態

reader UI・fixtureテスト・CI設定は実装済みです。Issue #4 worktreeでは48巻・2,140単位・英語本文268,999語が揃い、strict verifierとPython 12 testsが成功しました。最終50件の抜取確認は進行中で、Issue #3への統合、PR/mainでの全ゲート、Gitea公開は未完了です。詳細は[PLAN.md](PLAN.md)。

| 項目 | 状態 |
| :--- | :--- |
| 要求・仕様書 | 作成済み（[SPEC.md](SPEC.md)が機能・コンテンツ仕様の正本） |
| アプリ実装 | reader UIは実装済み。独立Claudeレビュー承認とPR CI #1成功。統合後の全巻検証・main gateは未完了 |
| 本文・日本語訳・解説データ | Issue #4 worktreeに48巻・2,140対訳単位・英語本文268,999語。212/212バッチ成功、strict verifierとPython 12 tests成功。最終50件の抜取確認は進行中。 |
| CI | PR CI #1（commit `7879ae6`）success: UI 20 tests、Python 9 fixture tests、typecheck、build。データ未配置だったためstrict gateはskip。Issue #4の最新データを含むPR CIとmain gateは未確認。 |
| 公開 | 未実施。Issue #3 PR #6とdemo-previews PR #95はopen。目標はGitea/CI経由でローカルネットワーク固定URL `homer-reader.honya.dev`。公開後のURL・container ID・主要操作検証は未実施。 |

## 読書の目的

『イリアス』『オデュッセイア』の両方を、作品→巻→本文の順に辿り、英語本文と日本語訳を同じ対訳単位で並べて読み進められる状態を目指します。全巻を読み通せることを達成条件とし、抜粋のみを完成扱いしません。この全巻方針はユーザーの直接指定ではなく、リポジトリ側の実装方針です（[SPEC.md](SPEC.md)のA1）。

## 予定する機能

要求IDの詳細はSPEC.mdへ集約しています。

| 機能 | 要求ID |
| :--- | :--- |
| 『イリアス』と『オデュッセイア』の2作品を収録する | R1 |
| 日本語解説を付けて読めるようにする | R2 |
| ブラウザで動作するSPAとして提供する | R3、R5 |
| 英語本文と日本語訳を同じ対訳単位で並べる（狭幅は上下） | R4、R8 |
| 作品→巻→本文の順に読めるようにする | R7 |
| 出典・訳者・AI生成有無・確認範囲を確認できるようにする | R12 |

検索、音声、公開SPAでの翻訳API呼出し、アカウントは今回追加しません。

## 文書

目的に応じて次の文書を参照します。

| 文書 | 内容 |
| :--- | :--- |
| [SPEC.md](SPEC.md) | 要求と出所、読書の流れ、本文・日本語訳・日本語解説の区別、データ契約、出典と品質検証、未決事項 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 要求IDに対応する観察可能な受入条件 |
| [PLAN.md](PLAN.md) | Issue #3/#4と公開台帳の役割、依存順、検証・公開ゲート、完了条件 |
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
# 全48巻のファイルが統合された後に実行する厳格ゲート
python3 scripts/validate-content.py --verify-published
npm run validate:content
```

`test`、`typecheck`、`build`、`validate:content:if-present`は本文データなしでも実行できます。任意版は`public/data`が空のときだけ検証をskipし、何か成果物があれば全量を検査します。`validate:content`とPythonの`--verify-published`は常に48巻を要求する厳格ゲートです。Issue #4 worktreeでは厳格検証済みですが、このbranchにはまだ本文が統合されていません。Pythonのparser fixture testは外部データを使わず実行できます。

UIはDADSの読みやすさ・アクセシビリティを基本にし、`IBM Plex Sans JP`を自己ホストします。320px幅とキーボード操作の実ブラウザ確認は未完了です。
