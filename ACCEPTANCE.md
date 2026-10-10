# 受入条件

[SPEC.md](SPEC.md)の要求IDに対応する、観察可能な合格条件です。

## 状態

main commit `c149af8`にUIと48巻データを統合済みです。PR CI #2（[pipeline 2](https://ci.honya.dev/repos/154/pipeline/2)、commit `3ad028b`）は22 UI tests、12 Python tests、Node/Python strict 48-book validationに成功し、main CI #3と台帳CI #184も成功しました。初回release `r1119-b3`はHTTP 200を確認し、配信57ファイルのhashがpublication metadataと一致しています。WebKitGTKで320×820表示、両作品の選択、第1巻の本文表示、マウス遷移、日英横並び、解説の開閉と5種類の注釈ラベルを確認しました。異常系・履歴移動などはfixtureで検証しています。実ブラウザでのdark mode、font fallback、全48巻の個別閲覧は未確認です。最新の配信・QA記録は[PLAN.md](PLAN.md)とIssue #3完了コメントを参照してください。全文の人手校閲は未実施です。

## 文書（Issue #1・当時の記録）

以下はIssue #1時点の受入結果です。D5の「コード等を含まない」とD6の「CI未構成」は当時の範囲を示し、現在のrepo状態を表しません。検証: 2026-10-10、Codex（相対リンク解決チェックと差分検査）。

- [x] D1: SPEC.mdが要求IDと出所を持ち、R1〜R14を記載している。
- [x] D2: U1〜U4の4件の発言が、Issue #1の要求IDと条件IDへ追跡できる（当時の追跡表）。
- [x] D3: 文書内の相対リンクがすべて解決する。
- [x] D4: 未確定の資料採用・権利・技術を確定仕様として書いていない（SPEC.md 5.3、11、16）。
- [x] D5: アプリコード、依存パッケージ、本文データ、デプロイ設定を含まない。
- [x] D6: CI未構成を記録し、ダミーのCIを追加していない。

Issue #1の完了条件のうち、commit、PR、別Agentの監査は本リポジトリのワークフロー側が担います。

## 後続依頼の追跡

- [x] D7: U5の実装・公開依頼をIssue #3/#4、S1〜S18、PLANの統合・公開工程へ追跡できる。
- [x] D8: U6の先行計画依頼をPLAN step 0と後続工程の役割・依存・証拠へ追跡できる。
- [x] D9: U7の公開先意図を、SPEC §5.1とPLANのGitea/固定URL公開工程へ追跡できる。固定URLでHTTP 200を確認し、配信hash一致を検証済み。

## SPA（2026-10-10検証）

以下は観察可能な受入条件です。合格は条件ごとにUI fixture、content gate、公開hash、または実画面の証拠を付けて記録し、証拠が不足する項目は未チェックのままにします。

- [x] S1: 2作品の一覧から各作品を開け、作品ごとに24巻を選べる（R1、R7）。WebKitGTKでカタログの48リンクからIliad 1とOdyssey 1を選択し、本文表示を確認。
- [x] S2: 全48巻がインデックスに存在し、欠落・欠番が0件である（R14）。PR CI #2のNode/Python strict verifierが48巻を検証。
- [x] S3: 作品→巻→本文の順にたどって本文へ到達できる（R7）。WebKitGTKで両作品の第1巻をカタログから開き、本文表示を確認。
- [x] S4: 英語本文と日本語訳が同じ対訳単位で並ぶ（R4、R8）。fixture app testとWebKitGTK実画面で日英本文の対応表示を確認。1280px幅では両段組が横並び。
- [x] S5: 対応する日本語訳がない区間を、対応済みの対訳として表示しない（R4、R8）。`src/data.test.ts`の空訳拒否と`src/app.test.ts`の不一致巻エラーfixtureが検証。
- [x] S6: 320px幅で英語本文と日本語訳が上下に並び、本文が横にはみ出さない（R8）。WebKitGTKで320×820 viewport/body/document widthが320px、横はみ出しなし。
- [x] S7: 巻切替と前後の巻への移動ができる（R7）。`src/app.test.ts`のfixtureがselector・前巻・次巻を検証。
- [x] S8: 作品・巻を表すURLを再読込すると同じ作品・巻を表示する。巻内の読書位置の保存は未採用の提案であり、この条件には含めない（R7）。`src/app.test.ts`でroute hashからの初期表示とback/forwardを検証。
- [x] S9: データ読込に失敗したとき再試行でき、成功時に本文が表示される（R13）。`src/app.test.ts`で巻データとcatalog両方のretry成功を検証。
- [x] S10: 解説を開くと、人物・地名・神話背景・難しい英語表現の区別が分かる（R2、R9）。WebKitGTKで解説の開閉と、英語表現・神話・人物・地名・解釈の各ラベルを実DOMで確認。
- [x] S11: 推測に基づく解説が「解釈」として表示され、断定と区別される（R10）。WebKitGTKで「解釈」ラベルを持つ注釈を確認。表示上の区別を確認したもので、注釈内容すべての事実性を保証するものではない。
- [x] S12: 先の展開に関わる記述が初期表示で隠れ、明示操作で表示される（R11）。`src/app.test.ts`でspoiler summary/bodyの初期状態と明示開閉を検証。
- [x] S13: 各巻で出典・訳者・AI生成有無・確認範囲を確認できる（R12）。`src/app.test.ts`で英訳者、日本語訳、解説生成方法、確認範囲、対応方法の表示を検証。
- [x] S14: キーボードだけで主要操作ができる（R3）。WebKitGTKでTabによるリンク/selectへのフォーカス移動を確認し、別途、次巻ボタンをEnterで操作してIliad 1→2の遷移を確認。Tabでselectをフォーカスしたこと自体は選択操作の証拠としない。
- [x] S15: 公開経路で配信された内容が、確認した本文・訳・解説と一致する（A4、公開工程）。初回release `r1119-b3`で57配信file hashes全件がpublication metadataと一致。
- [x] S16: 全48巻について、対訳単位を順に連結した英文が、記録した正規化規則を適用した採用底本の本文と一致し、本文の省略・重複が0件である（R14、A1）。PR CI #2のsource-manifest verifierが48巻・2,140単位を検証し、原文抽出時の照合根拠は[CONTENT.md](CONTENT.md)に記録。
- [x] S17: 全対訳単位に非空の英文・日本語訳があり、対応未確定が0件である。日本語訳の省略・取り違えを本文と照合した方法・範囲・結果を記録し、検出した問題を解消している（R4、R8、A1）。strict content gateが全2,140単位の形状・空欄を検査。98 distinct units / 11,718語と別途1単位を抜取照合し、6件の限定修正と棄却理由を[CONTENT.md](CONTENT.md)に記録。全文の人手校閲ではない。
- [x] S18: 作品・巻の切替と戻る・進む操作が、ページ全体の再読込を伴わずに動作する（R5）。`src/app.test.ts`のhashchange・back/forward fixtureでroute transitionと表示更新を検証。WebKitGTKでもカタログ→Iliad 1→カタログ→Odyssey 1の遷移で`performance.timeOrigin`が同一であり、ページ再読込なしを確認。

しおり・続きから読む・表示言語切替・テーマ切替は未採用の提案です。採用する場合はSPEC.mdの提案区分と受入条件を同時に更新します。

## 追跡表

Issue #1のU1〜U4から要求ID・条件IDへの対応と、後続U5〜U7の実装・計画・公開工程への対応です。要求の原文は[SPEC.md](SPEC.md)の5.1に置きます。

| 発言 | 要求ID | 条件ID |
| :--- | :--- | :--- |
| U1 両方の作品と日本語解説 | R1、R2 | S1、S2、S10、S11、S16 |
| U2 ブラウザで日英対訳・解説 | R3、R4 | S4、S5、S6、S14、S17 |
| U3 SPA | R5 | S18 |
| U4 リポジトリと仕様書を先に | R6 | D1〜D6 |
| U5 subagentで実装・公開 | SPEC §5.1の実装依頼 | PLAN step 1〜5、Issue #3/#4、S1〜S18、公開条件 |
| U6 リポジトリに計画を先に記録 | SPEC §5.1の計画依頼 | D8、PLAN step 0〜5 |
| U7 Giteaで公開（親Agentによる意図解釈） | SPEC §5.1の公開先依頼 | D9、PLAN step 4〜5、公開後検証 |

Agentが本Issueで具体化した要件（R7〜R14）は、SPEC.mdの5.2の出所と、各条件に併記した要求IDに対応します。
