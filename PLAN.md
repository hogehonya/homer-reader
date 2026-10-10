# homer-reader 実装・公開計画

この計画はIssue #3（読書UI）・Issue #4（本文データ）・demo-previews Issue #94（公開台帳）をつなぐ実行順と完了証拠の正本です。機能・データ仕様は[SPEC.md](SPEC.md)、観察可能な受入条件は[ACCEPTANCE.md](ACCEPTANCE.md)を参照します。計画を変える場合は根拠と状態を更新します。

Issue #9は既存1,375注釈の日英表示を追加する変更です。要求追跡はSPEC §5.1のR15、受入条件は[ACCEPTANCE.md](ACCEPTANCE.md)のN1〜N7に記録します。

## 目的と範囲

イリアスとオデュッセイアを、英語本文・AI日本語訳・短い日本語解説で読める静的SPAとして完成させ、全巻の完全性・出典・対応関係を検証した後に公開します。全48巻を完成条件とするのはSPECのAgent方針A1であり、U5の直接要求とは区別します。抜粋・未確認の許諾・未検証データを完成版または公開済みとして扱いません。

対象repoはGiteaの`honya-dev-spa/homer-reader`、公開先はローカルネットワーク固定URL `homer-reader.honya.dev`です（SPEC U7の親Agentによる意図解釈）。Issue #3 PR #6、Issue #4 PR #7、公開台帳PR #95はmainにマージ済みです。main CI #3とCI #184は成功し、初回公開と記載範囲の画面QAも完了しました。二回目の配信結果はIssue #3完了コメントを参照します。

## 現在確認できている状態

2026-10-10時点で、main commit `c149af861d9f574ee3e4abafcbefcbd0c0621a47`にreader UIと48巻・2,140対訳単位・268,999英語語のデータが統合され、初回公開release `r1119-b3`として配信済みです。main CI #3と公開台帳CI #184は成功。CI metadataの`created_at_jst`は`2026-10-10T17:30:23+09:00`（CI作成時刻）で、公開後HTTP 200を`2026-10-10 17:44:30 JST`に実測しました。配信57ファイルのhashがpublication metadataに一致し、初回登録後container IDは`83485a1a23df505b9300091b8adbd9e0265c704f041eb61b8a54c01ab9ae8ea0`です。二回目の更新はこの文書PRのmain CIで行う計画です。WebKitGTKで320×820、両作品の第1巻表示とマウス遷移、1280pxで日英横並び、解説の開閉と5種の注釈ラベル、Tabによるフォーカス移動、Enterによる次巻遷移を確認しました。異常系・back/forward等はfixtureで検証し、実ブラウザでのdark mode、font fallback、全48巻の個別閲覧は未確認です。翻訳・出典の根拠と限界は`CONTENT.md`を参照します。

## 役割と作業場所

Issue #9の作業順は、先にこの仕様・受入条件・役割をcommitし、その後UIと注釈データを独立に進め、双方の完了後に統合検証と公開へ進みます。

| 役割 | 責任 | 境界 |
| :--- | :--- | :--- |
| controller（親Agent） | Issue #3/#4の統合、別Agent監査、Issue #94/PR #95の台帳統合、CI有効化確認、公開後QA、完了記録 | UI・データの個別worktreeで競合編集しない。公開を成功と報告する前に証拠を確認する。 |
| UI実装担当 | Issue #3専用`feature/issue-3` worktreeで仕様、SPA、データ検証器、UIテスト、build・CIを実装し、狭い差分をcommitする | 本文全文、台帳、他repo、push・PR・merge・公開は変更しない。 |
| コンテンツ担当 | Issue #4専用の別worktreeでIssue #3のJSON契約に沿う48巻の本文・翻訳・解説・出典情報を整備し、完全性の証拠を残す | UI実装と同じファイルを編集しない。UI側は受領後に結合検証する。 |
| 監査担当 | UI実装とコンテンツ統合を独立にレビューし、受入条件・差分・検証証拠を確認する | 実装者の自己レビューだけでゲートを通さない。 |
| Issue #9 UI担当 | TypeScriptの注釈契約・描画・CSS・fixtureとUI testsを更新する | `public/data`、Python importer/validator、CONTENT.mdは編集しない。データ担当の成果物に依存するintegrationは後段。 |
| Issue #9 注釈データ担当 | 全48巻の既存日本語注1,375件に英語見出し・本文を追加し、再現可能な生成・検証・抜取確認記録を整える | 日本語本文・注釈の既存構造や順序を変えない。UI実装用ファイルを編集しない。 |

Issue #3/#4と公開台帳の工程は完了済みです。Issue #9ではUI担当が`feature/issue-9` worktreeでTypeScript契約・描画・CSS・fixture testsを編集し、注釈データ担当が別worktreeで48巻の注釈英訳・生成検証記録を整えます。統合と公開はcontrollerが担当します。

## 翻訳・出典方針とリスク

- 英語底本候補はSamuel Butler訳です。Project Gutenbergの米国public domain表示は確認済みですが、日本での公開条件、本文の版・欠落、再配布・出典要件の最終確認を公開前ゲートにします。
- 日本語本文は採用英訳からのAI全訳とし、既存商業訳を転載しません。日本語の短い解説も生成方法と確認範囲を表示します。
- 翻訳のバッチ生成は承認済みのcodex-deepseek実行経路を使い、実行時認証情報はInfisicalから注入します。公開SPAは翻訳APIを呼び出しません。
- 全文の人手校閲は完了条件として既知の前提にしません。実施した抜取確認だけを範囲・方法・結果とともに表示し、未確認箇所を人手確認済みと示さないことをリスクとして扱います。
- 日英の対応は安定IDと参照情報で表し、本文をHTMLとして解釈しません。対訳不一致、空本文、欠巻、出典不明は公開を止めます。

## 依存順と証拠

| 順 | 作業 | 完了証拠 | 状態 |
| :--- | :--- | :--- | :--- |
| 0 | 本計画と実装方針をrepoの正本に記録する | PLAN・SPEC・READMEのリンクとdiff検査、計画専用docs-only commit | 完了（mainに統合済み） |
| 1 | Issue #3でreader UI、共有JSON契約、検証スクリプト、fixtureテストを実装 | UI commit `d1ec6b1`は独立Claudeレビュー承認。PR CI #2（commit `3ad028b`）success: 22 UI tests、12 Python tests、Node/Python strict 48-book verification。 | 完了。PR #6はmainにマージ済み。 |
| 2 | Issue #4で48巻データを作成し、Issue #3へ統合 | catalog 2作品各24巻、source manifest、strict verifier、出典・生成・抜取確認範囲 | 完了。212/212バッチ、48巻・2,140単位・268,999英語語。98 distinct units / 11,718語と別途1単位を抜取確認、6件の限定修正を記録。PR #7はmainにマージ済み。 |
| 3 | Issue #3と#4を統合し、CI検証する | main commit `c149af8`、PR CI #2とmain CI #3の全ゲート成功。WebKitGTKで320px表示、作品選択・巻遷移・日英横並び・注釈開閉を確認。異常系と履歴移動はfixture検証。 | コード・データ統合、main CIと定義した画面QA完了。 |
| 4 | demo-previews Issue #94 / PR #95で台帳登録し、controllerがCIを確認 | PR #95 merged、CI #184 success。 | 完了。 |
| 5 | Gitea mainでCI公開し、固定URLを検証 | 初回release `r1119-b3`、main commit `c149af861d9f574ee3e4abafcbefcbd0c0621a47`。HTTP 200 at 2026-10-10 17:44:30 JST。metadataの`created_at_jst` `2026-10-10T17:30:23+09:00`はCI作成時刻。57配信file hashes全件一致。 | 初回公開成功。初回登録後container ID `83485a1a23df505b9300091b8adbd9e0265c704f041eb61b8a54c01ab9ae8ea0`。画面QAは実施範囲を確認済み、残る制限は本節の記載どおり。二回目の配信・hash照合・URL/container ID維持をこのdocs PRのmain CIで確認する。初回登録前IDは比較対象外。二回の配信結果は[Gitea Issue #3](https://gitea.honya.dev/honya-dev-spa/homer-reader/issues/3)の完了コメントを正本として記録し、第三回配信は要求しない。 |

計画の記録後、Issue #3のUI、Issue #4のデータ、台帳PR/CIの準備は独立に並行できます。UIと全48巻データの統合検証は双方の作業完了後に行い、公開は統合ゲートと台帳・CI調整の完了後に限ります。Issue #3単体のbuild成功は、全文データの完成や公開条件の充足を意味しません。

## 品質ゲート

1. **UI開発**: `npm test`、`npm run typecheck`、`npm run build`。fixtureでルーティング境界、異常JSON、fetch競合、HTML文字列の安全表示、解説・ネタバレ操作、日英対応を確認する。320px幅、キーボード、ライト／ダーク、フォントfallbackを実画面で確認する。
2. **全文データ**: `python3 -m unittest discover -s tests/content -v`で原文パーサと検証器のfixture試験を行い、`python3 scripts/validate-content.py --verify-published`と`npm run validate:content`を両方通す。出典manifestと48巻の英語本文が原文の正規化結果に一致し、catalog・全巻ファイル・日英本文・ID・件数・解説schemaが揃うこと。底本全体との照合、日英の意味的対応、利用条件は別記録で確認する。
3. **公開前CI**: PRではUIテスト・buildとparser testを行い公開しない。PRの出典manifest・48巻検査とUI content validatorは`public/data`が完全に空のときだけskipし、1つでも成果物があれば両方を厳格実行する。main push/manualでは2つのstrict validatorとparser testを常に実行し、全て成功した場合だけ`dist/index.html`、`dist/assets`、`dist/fonts`、`dist/data`を明示して公開payloadを作る。
4. **配信確認**: static-publishのpayload hash・CI identity検査と配信metadata照合が成功し、公開URLで作品選択・巻切替・再読込・前後移動・解説・エラー復帰の主要操作を確認する。registry登録後の第一回配信と第二回更新で、URLとcontainer IDが維持され、publication metadataが各対象commitを示すことを確認する。登録前のcontainer IDは比較対象にしない。HTTP 200の公開確認時刻と`created_at_jst`（CI作成時刻）を分けて記録する。二回の配信実績はIssue #3完了コメントから参照でき、証跡を追記するための第三回配信は行わない。画面確認と全巻内容の人手校閲は別の証拠とする。

## 完了条件

- Issue #3のUI・共有データ契約・意味のあるテスト・再現可能なbuild・欠損データでは公開できないCI・更新済み資料が揃い、監査と検証が記録されている。
- Issue #4の48巻が契約を満たし、権利・出典・底本照合・対応品質・AI生成と抜取確認の限界が正確に記録されている。
- Issue #94の台帳登録がrepo、site、hostと一致し、mainのCI公開が成功している。
- 公開`publication.json`が対象commitとCI実行に一致し、公開画面の主要操作が確認済みである。
- 未実施の検査、人手未確認の範囲、残るリスクを明示し、抜粋や部分工程を完了として扱わない。
