# Classroom Hooks

A teacher-facing prototype for drafting lesson openers with traceable cultural references. Built with Claude Code and Codex for the Qloo Agentic Hackathon. This is **source preparation, not a submitted entry or a verified live service**.

## 現在の状態（2026-10-14 UTC）

合成データによる21件のテストで、根拠ID照合、API指定、学年ポリシー、失敗時の応答、MCP経由の同一処理を確認した。実Qloo API、Workers AI、Cloudflare上の動作、外部MCPクライアントとの接続は未検証。キー発行・アカウント登録・公開デモ・大会提出は未完了。

## 手元で確認する

Node.js 22以上。テストと合成データのプレビューにはパッケージ追加・秘密値・外部通信は不要。

```sh
npm test
npm run preview
```

`http://127.0.0.1:8798` を開き、学年と単元を入力する。画面上部に合成データと明示され、固定の架空題材を使うテンプレート応答を確認できる。終了はCtrl+C。実サービスの動作証拠にはならない。

## 実装

- `src/agent.js`: 最大8段階のJSONツール呼び出し。検索・Insightsが返した実体をそのリクエスト専用の一覧に保持する。
- `src/concept.js`: 回答の全参照IDを一覧と照合。未知ID・タグID・不正な回答を拒否し、名称・数値・根拠ラベルを取得結果から再構成する。学年ごとの映画・TVのrating設定と広い年齢信号を上書き不能にする。
- `src/qloo.js`: キーをサーバ内のヘッダーで使用。10秒の取得期限、転送拒否、API例外の固定文言化。ゲームのInsights種別は `urn:entity:video_game`。
- `src/worker.js`: `POST /api/run` とMCPの `build_classroom_hooks` を同じ検証付き処理へ接続する。空の結果を成功にしない。`/api/health` は設定の有無だけを返し、接続成功とは扱わない。
- `public/index.html`: 下書きと取得参照を表示する。モデルの思考過程は表示しない。

## 限界

Qlooの `24_and_younger` は学齢児童だけの区分ではない。特定の生徒や学年の好みを測定したとは言えない。映画・TVに送るratingフィルターは他の領域には適用されず、適切さの保証でもない。ID照合は存在する実体との対応を確認するだけで、活動文中の事実・数字・教育的効果は検証しない。授業前の教員確認が必要。

生徒の氏名や個人情報は入力しない。実運用では入力がQlooとCloudflareのモデルへ渡る。Qloo応答のキャッシュはサーバ内に置き、実応答データを公開リポジトリへ追加しない。現在の公開物には合成データのみ含む。

公開デプロイ前には、実APIのパラメーターと返却形式、映画・TVのrating、無料枠での動作と費用設定、利用制限、エンドツーエンド動作を検証する。現在のコードには利用者ごとの濫用制限がなく、無料枠を使い切られる可能性がある。MCPはJSON応答の限定実装で、全クライアント互換を主張しない。

## デプロイ準備（未実施）

`wrangler.example.toml` は秘密を含まない設定ひな型。実設定とキーは管理者の専用接続経路で設定する。リポジトリには認証情報・実設定・実Qloo応答を含めない。Workersの無料プラン以外を有効化しない。実デプロイ時に使用するWrangler版を確認し、ひな型と静的ファイル/API経路の対応を検証する。

## English overview

A teacher chooses a grade, topic and optional cultural references. A small tool-using agent resolves references with Qloo Search, expands through Insights, and drafts activities. Every anchor ID must appear in the current run's tool results; the server rebuilds names and evidence labels from those results. Invalid answers are rejected. A model outage or repeated invalid answers can fall back to templates backed by Qloo; unavailable Qloo results fail visibly.

This verifies entity identity, **not** factual accuracy of activity prose, classroom suitability, student preferences or learning outcomes. The demographic signal covers ages 24 and younger. The local preview is fully synthetic. No hosted demonstration or live API verification is currently claimed.

## 一次資料

- [Qloo hackathon guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide)
- [Parameter reference](https://docs.qloo.com/reference/parameters)
- [Parameters by entity type](https://docs.qloo.com/reference/available-parameters-by-entity-type)
- [Official competition requirements](https://qloo.devpost.com/rules)

MIT License. Copyright 2026 Kanata Works.
