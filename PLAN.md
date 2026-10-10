# homer-reader 実装・公開計画

この計画はIssue #3（読書UI）・Issue #4（本文データ）・demo-previews Issue #94（公開台帳）をつなぐ実行順と完了証拠の正本です。機能・データ仕様は[SPEC.md](SPEC.md)、観察可能な受入条件は[ACCEPTANCE.md](ACCEPTANCE.md)を参照します。計画を変える場合は根拠と状態を更新します。

## 目的と範囲

イリアスとオデュッセイアを、英語本文・AI日本語訳・短い日本語解説で読める静的SPAとして完成させ、全巻の完全性・出典・対応関係を検証した後に公開します。全48巻を完成条件とするのはSPECのAgent方針A1であり、U5の直接要求とは区別します。抜粋・未確認の許諾・未検証データを完成版または公開済みとして扱いません。

対象repoは`honya-dev-spa/homer-reader`、公開site候補は`homer-reader`、hostは`homer-reader.honya.dev`です。公開台帳PR #95（demo-previews Issue #94）はUI実装の担当範囲外で、controllerが公開工程で統合します。

## 現在確認できている状態

controllerの2026-10-10報告では、Samuel Butler英訳48巻を取得済みで、日本語訳の生成を4 workerで進行中です。content担当の直近報告は212バッチ中65件成功・失敗0件です。現在の集計目標は2作品合計2,140対訳単位・英語268,999語です。これらは進行中の報告値で、完成・完全性を示す検証済み件数ではありません。出典manifestと再現可能な検証器をデータ成果物とともに確認し、統合時に確定値を記録します。demo-previewsの台帳変更PR #95はCI #183成功、未マージです。homer-reader CI repo ID 154は有効化済みでtrusted volumesが設定済みとの報告です。公開は未実施で、外部状態は統合・公開時に再確認します。

## 役割と作業場所

| 役割 | 責任 | 境界 |
| :--- | :--- | :--- |
| controller（親Agent） | Issue #3/#4の統合、別Agent監査、Issue #94/PR #95の台帳統合、CI有効化確認、公開後QA、完了記録 | UI・データの個別worktreeで競合編集しない。公開を成功と報告する前に証拠を確認する。 |
| UI実装担当 | Issue #3専用`feature/issue-3` worktreeで仕様、SPA、データ検証器、UIテスト、build・CIを実装し、狭い差分をcommitする | 本文全文、台帳、他repo、push・PR・merge・公開は変更しない。 |
| コンテンツ担当 | Issue #4専用の別worktreeでIssue #3のJSON契約に沿う48巻の本文・翻訳・解説・出典情報を整備し、完全性の証拠を残す | UI実装と同じファイルを編集しない。UI側は受領後に結合検証する。 |
| 監査担当 | UI実装とコンテンツ統合を独立にレビューし、受入条件・差分・検証証拠を確認する | 実装者の自己レビューだけでゲートを通さない。 |

UI作業場所は`/home/honya/repos/worktrees/homer-reader-issue-3`、ブランチは`feature/issue-3`です。コンテンツ担当は別のIssue #4 worktreeを使います。公開台帳Issue #94は`demo-previews`側の独立作業です。

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
| 1 | Issue #3でreader UI、共有JSON契約、検証スクリプト、fixtureテストを実装 | Issue #3 worktreeのcommit、test・typecheck・build結果、独立監査結果 | UI・テスト実装済み、ローカル検査成功。独立監査・統合待ち |
| 2 | Issue #4で48巻データを別worktreeに作成 | catalogに作品ごと24巻、全ファイル・全単位の非空日英本文、コミット済みsource manifest・再現可能な検証結果、出典・生成・抜取確認範囲 | 212バッチ中65件成功・失敗0件との直近報告。目標2,140対訳単位・英語268,999語は未検証 |
| 3 | Issue #3と#4をcontrollerが統合して検証 | 統合commit、48巻完全性・底本照合・日英対応・出典監査、UI全条件の結果 | 未着手 |
| 4 | demo-previews Issue #94 / PR #95で台帳登録し、controllerがCIを確認 | PR #95・CI #183成功、未マージ。CI repo ID 154有効・trusted volumes設定済みとの報告。release準備後に台帳とmain用CIを再確認 | release準備まで保留 |
| 5 | mainでCI公開し、配信先を検証 | CIのtest/typecheck/build/content gate成功、static publishのprepare→publish→verify成功、`publication.json`のcommit/pipeline一致、画面の主要操作確認 | 未着手 |

計画の記録後、Issue #3のUI、Issue #4のデータ、台帳PR/CIの準備は独立に並行できます。UIと全48巻データの統合検証は双方の作業完了後に行い、公開は統合ゲートと台帳・CI調整の完了後に限ります。Issue #3単体のbuild成功は、全文データの完成や公開条件の充足を意味しません。

## 品質ゲート

1. **UI開発**: `npm test`、`npm run typecheck`、`npm run build`。fixtureでルーティング境界、異常JSON、fetch競合、HTML文字列の安全表示、解説・ネタバレ操作、日英対応を確認する。320px幅、キーボード、ライト／ダーク、フォントfallbackを実画面で確認する。
2. **全文データ**: `npm run validate:content`が成功すること。両作品が24巻、合計48巻であり、欠巻・欠ファイル・不正参照・空または重複ID・空日英本文・解説schema違反がない。底本全体との省略・重複照合、日英の意味的対応、利用条件は別記録で確認する。
3. **公開前CI**: PRでは品質検査・buildだけを行い公開しない。main push/manualは全品質ゲート後に限り、`dist/index.html`、`dist/assets`、`dist/fonts`、`dist/data`を明示して公開payloadを作る。全巻が未配置ならbuildの成功にかかわらずcontent gateで停止する。
4. **配信確認**: static-publishのpayload hash・CI identity検査と配信metadata照合が成功し、続けて公開URLで作品選択・巻切替・再読込・前後移動・解説・エラー復帰の主要操作を確認する。更新を2回実行し、URLと共用container IDが維持されpublication metadataが各対象commitを示すことも確認する。画面確認と全巻内容の人手校閲は別の証拠とする。

## 完了条件

- Issue #3のUI・共有データ契約・意味のあるテスト・再現可能なbuild・欠損データでは公開できないCI・更新済み資料が揃い、監査と検証が記録されている。
- Issue #4の48巻が契約を満たし、権利・出典・底本照合・対応品質・AI生成と抜取確認の限界が正確に記録されている。
- Issue #94の台帳登録がrepo、site、hostと一致し、mainのCI公開が成功している。
- 公開`publication.json`が対象commitとCI実行に一致し、公開画面の主要操作が確認済みである。
- 未実施の検査、人手未確認の範囲、残るリスクを明示し、抜粋や部分工程を完了として扱わない。
