# AGENTS.md — homer-reader

上位の共通`AGENTS.md`（Codex共通運用）を適用し、本リポジトリでは次を追加します。

## 現在の工程

- Issue #1の文書整備は完了しています。Issue #3はreader UI・データ契約・テスト・CI構成、Issue #4は本文48巻の整備を担当し、別worktreeで並行します。
- main commit `c149af8`へUIと48巻データを統合し、初回release `r1119-b3`を公開済みです。PR CI #2、main CI #3、台帳CI #184、配信57ファイルhash一致を確認しました。最新の配信検証記録は[Gitea Issue #3](https://gitea.honya.dev/honya-dev-spa/homer-reader/issues/3)の完了コメントを参照してください。
- Issue #9の日英注釈はPR #10でmainに統合済みです。受入・配信証拠は[Gitea Issue #9](https://gitea.honya.dev/honya-dev-spa/homer-reader/issues/9)の完了コメントを参照します。
- Issue #11はブラウザー標準SpeechSynthesisによる読み上げを追加します。外部TTS API・音声ファイル生成を追加せず、オフライン動作を保証しません。受入・実音声確認は[Gitea Issue #11](https://gitea.honya.dev/honya-dev-spa/homer-reader/issues/11)の完了記録を参照します。
- Issue #13では`#/voices`の固定試聴サンプル比較を追加します。SPAは再生時に外部TTS APIを呼ばず、音声・manifestの受入と公開結果は[Gitea Issue #13](https://gitea.honya.dev/honya-dev-spa/homer-reader/issues/13)の最新記録を参照します。
- 機能・コンテンツ仕様の正本は`SPEC.md`、受入条件の正本は`ACCEPTANCE.md`です。要求を変える場合は`SPEC.md`の要求IDを先に更新し、対応する条件を`ACCEPTANCE.md`へ反映します。
- 要求の原文引用は`SPEC.md`の5.1だけに置き、他文書へ複製しません。

## 文書の境界

- ユーザーの明示決定、Agentが本Issueで具体化した要件、Agent方針、Agent提案、未検証情報、確認済み事実を区別して書きます（`SPEC.md` 4）。
- 未確定の資料採用・権利・技術を確定仕様として書きません。未取得の本文と未確認の許諾を、取得済み・確認済みとして扱いません。
- 実装方針の全巻方針（A1）を、ユーザーの直接指定として書きません。
- 実URLや公開済みの状態を捏造しません。公開先はGitea/Woodpecker経由のローカルネットワーク固定URL `homer-reader.honya.dev`です。PR #6、#7、台帳PR #95はマージ済みです。初回HTTP 200と画面操作を確認済みです。最新の配信検証・QA記録はREADME.mdとIssue #3完了コメントを参照してください。

## 実装・コンテンツ工程の契約

- 英訳・日本語訳の利用条件と出典表示要件の確認根拠はIssue #4 `CONTENT.md`に記録する。既存の商業訳、再利用条件不明のサイト、確認根拠のない全文を転載しない。プロジェクト上の権利評価を法律意見として扱わない。
- 段落対応が揃っていない翻訳を、対応済みの対訳として表示しない。ギリシア語原典の参照（巻・行）と英訳の段落番号を別のフィールドで扱う。
- 秘密情報を成果物・ログ・リポジトリへ含めない。公開SPAの実行時に外部翻訳APIを使わない。
- 検査、build、公開の手順はPLAN.mdを参照し、公開前に両作品24巻ずつの欠損と対応を検証する。

## 検証

実装と文書を次の手順で検証します。`validate:content:if-present`は`public/data`が完全に空の場合だけskipします。統合済みデータに対して厳格なvalidatorを実行します。

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run validate:content:if-present
python3 -m unittest discover -s tests/content -v
python3 scripts/validate-audio-samples.py
# 全48巻を要求する厳格ゲート
python3 scripts/validate-content.py --verify-published
npm run validate:content
# 相対リンクの解決確認
grep -rhoE '\]\([^()#]+\.md\)' *.md | sed -E 's/^\]\(//; s/\)$//' | sort -u | while read -r f; do [ -f "$f" ] || echo "missing: $f"; done
git diff --check
```

実装後は、`SPEC.md` 12の品質検証と`ACCEPTANCE.md`のS1〜S18を、要求IDごとに結果と検証日を添えて確認します。
