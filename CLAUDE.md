# CLAUDE.md — プロジェクト規定

このファイルは Claude (AI) がコードを生成・編集する際に従うべきルールを定義する。
プロジェクトのすべてのコードはこの規定に準拠すること。

---

## 1. 開発言語・スタック

| 項目 | 採用技術 |
|------|----------|
| フロントエンド | TypeScript (strict mode) |
| バックエンド | Python 3.11+ (FastAPI / Flask 等) |
| フレームワーク | Next.js 14 (App Router) |
| ORM | Prisma |
| DB | PostgreSQL (Supabase / Docker) |
| AI | Gemini 1.5 Flash (Google AI Studio) |

---

## 2. コーディング規約

### 2-1. 言語
- コメント、ドキュメント、ログはすべて **日本語**。
- TS: すべての関数に JSDoc を記載。
- Python: すべての関数に **型ヒント (Type Hints)** と **Googleスタイル等のDocstring** を記載。

### 2-2. JSDoc
- すべての関数とインターフェースに `/** ... */` 形式で引数・戻り値・例外の型を明記すること。

```ts
/**
 * ニュース記事をDBに保存する
 * @param article - 保存対象の記事データ
 * @returns 保存されたArticleレコード
 * @throws {PrismaClientKnownRequestError} DB制約違反時
 */
async function saveArticle(article: ArticleInput): Promise<Article> { ... }
```

### 2-3. 意図の記述 (Why)
- コードを見ればわかる「何をしているか」ではなく、**なぜその処理や設計が必要なのか** を詳細に記述すること。

```ts
// ❌ 悪い例
// urlでフィルタリングする
const exists = await prisma.article.findFirst({ where: { url } });

// ✅ 良い例
// News APIは同一記事を複数回返すことがある。URLはRFC的に一意であるため、
// 重複保存を防ぐキーとして使用する（titleは微妙に変わるケースがあり不適）。
const exists = await prisma.article.findFirst({ where: { url } });
```

### 2-4. 構造化
- ファイルが **100行を超える場合** は `// --- Section Name ---` で視覚的に区切ること。

```ts
// --- 型定義 ---
// --- DB操作 ---
// --- APIコール ---
// --- ユーティリティ ---
```

### 2-5. C# 比較コメント
- TypeScript特有の書き方をする箇所には末尾に補足コメントを添えること。

```ts
const title = article.title ?? '無題';            // C# の null 合体演算子に相当
const url = article.url!;                          // C# の null 非許容アサーションに相当
type Status = 'pending' | 'summarized' | 'posted'; // C# の enum に相当（Union型）
const result = await fetchNews();                  // C# の await Task<T> に相当
```
---

## 3. セキュリティ・運用ルール

### 3-1. 秘密情報
- APIキー、パスワード、トークン等をソースコードに **ハードコードすることを厳禁** とする。
- 必ず `.env` ファイルを使用し、`.gitignore` に含めること。

```
# .gitignore に必須
.env
.env.local
.env*.local
```

### 3-2. 実行承認
以下のコマンドを実行する前には、**必ずユーザーの承認を得ること**。
- ネットワーク通信（API実行）
- 外部パッケージのインストール (`npm install`, `pip install` 等)
- ファイルの削除を伴うコマンド (`rm`, `prisma migrate reset` 等)

### 3-3. 機密フォルダ
- `~/.ssh`, `~/.aws` などの機密情報を含むフォルダをスキャン対象やコンテキストに **含めないこと**。

---
### 3-4. 開発環境 (Docker)
- 開発環境は Docker コンテナ内に構築する。
- ホストマシン（Windows/WSL2）に直接パッケージをインストールせず、`docker-compose.yml` を定義してその中で実行すること。
- `docker-compose up` で開発サーバー、DB、バックエンドがすべて立ち上がる構成を目指す。
---

## 4. ワークフロー (設計思想)

### 4-1. DBファースト
```
News API取得 → DB保存(Prisma) → AI要約 → 投稿
```
- 取得したニュースデータは、加工や要約の前に **必ず一度DBへ保存** し、永続化すること。
- 障害やAPI制限が発生しても、取得済みデータを再処理できる設計とする。

### 4-2. ステータス管理
DB内で以下のステータスを管理し、**重複処理を防ぐ**こと。

| ステータス | 説明 |
|------------|------|
| `pending` | 取得済み・未処理 |
| `summarized` | AI要約済み |
| `posted` | 外部投稿済み |
| `error` | 処理エラー（再試行対象） |

---

## 5. ディレクトリ構成（目安）

```
├── frontend/           # Next.js プロジェクト
│   ├── app/            # App Router (api/含む)
│   ├── lib/            # db.ts, newsApi.ts, gemini.ts 等
│   ├── types/          # 共通型定義
│   └── next.config.js
├── backend/            # Python プロジェクト
│   ├── services/       # ビジネスロジック
│   └── requirements.txt
├── prisma/             # DBスキーマ定義 (schema.prisma)
├── scripts/            # 動作確認スクリプト (testNewsApi.ts等)
├── docker-compose.yml  # Docker構成管理
└── CLAUDE.md           # 本規定
```
---
## 6. Git運用ルール
- **ブランチ作成**: 新機能や修正を行う際は、必ず `feature/機能名` や `fix/問題点` という名前のブランチを新しく作成して作業すること。
- **コミットメッセージ**: 日本語で記述し、プレフィックス（feat:, fix:, docs:, chore: など）を付けること。
  - 例: `feat: ログイン画面のバリデーション機能を追加`
- **マージ**: 作業完了後は、ビルドとテストが通ることを確認してから `main` ブランチへマージすること。
- **プッシュ**: 重要な区切りでリモートリポジトリにプッシュすること。

## 7. 開発・ビルドコマンド
フロントエンド (Next.js)
- 依存関係インストール: docker compose run --rm frontend npm install
- 開発サーバー起動: docker compose up frontend
- ビルド: npm run build
- リンター: npm run lint

バックエンド (Python)
- 依存関係インストール: docker compose run --rm backend pip install -r requirements.txt
- サーバー起動: docker compose up backend

DB / その他
- DB起動: docker compose up -d db
- プリズママイグレーション: npx prisma migrate dev
  
## 8. コーディングスタイル
- **言語**: TypeScriptを使用。型定義を厳格に行うこと。
- **React**: 関数コンポーネントとHooksを使用。
- **UI**: Tailwind CSSを使用。レスポンシブデザインを意識すること。
- **設計**: コンポーネントは `src/components` 内に機能単位で分割すること。

## 9. 動作の優先事項
- コード修正後は、必ず `npm run lint` を実行してエラーがないか確認すること。
- エラーが発生した場合は、原因を分析して修正案を提示し、私の承認を得てから実行すること。