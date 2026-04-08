// --- トップページ: AI要約ニュース一覧 ---
// Next.js 14 Server Component として実装する。
// サーバー側で Prisma を直接呼び出せるため、APIルートを挟まずにDBから取得できる。
// これにより余分なネットワークラウンドトリップを排除し、初期表示を高速化できる。

import { prisma } from '../../lib/db';

// --- 型定義 ---

/**
 * 表示に必要なカラムのみ取得するための型。
 * SELECT * を避けることで、不要なデータ転送（summary以外の長文等）を防ぐ。
 */
type ArticleCard = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string | null;
  publishedAt: Date | null;
};

// --- データ取得 ---

/**
 * status が "summarized" の記事を公開日時の新しい順に取得する。
 * Server Component から直接呼び出すことで、クライアントへのAPI露出を避ける。
 *
 * @returns 表示用記事リスト（最大50件）
 */
async function getSummarizedArticles(): Promise<ArticleCard[]> {
  return prisma.article.findMany({
    where: { status: 'summarized' },
    orderBy: { publishedAt: 'desc' },
    take: 50, // 一度に大量取得してメモリを圧迫しないよう上限を設ける
    select: {
      id: true,
      title: true,
      summary: true,
      url: true,
      source: true,
      publishedAt: true,
    },
  });
}

// --- ユーティリティ ---

/**
 * Date を日本語の相対時間または絶対日時文字列に変換する。
 * 24時間以内は「N時間前」、それ以降は「YYYY年M月D日」形式で返す。
 *
 * @param date - 変換対象の日時（null の場合は "日時不明" を返す）
 * @returns フォーマット済みの日時文字列
 */
function formatDate(date: Date | null): string {
  if (!date) return '日時不明';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) return 'たった今';
  if (diffHours < 24) return `${diffHours}時間前`;

  // 24時間以上前は絶対日時で表示する
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Gemini が生成した箇条書きテキストを行の配列に変換する。
 * "- " で始まる行を整形し、空行を除去する。
 *
 * @param summary - Geminiが生成した要約テキスト（"- 内容\n- 内容" 形式）
 * @returns 表示用の文字列配列
 */
function parseSummaryLines(summary: string): string[] {
  return summary
    .split('\n')
    .map((line) => line.replace(/^[-・]\s*/, '').trim()) // "- " や "・" プレフィックスを除去
    .filter((line) => line.length > 0);
}

// --- コンポーネント ---

/**
 * 記事が0件のときに表示するエンプティステート。
 * パイプラインが未実行の場合もここが表示される。
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="mb-4 text-6xl opacity-20">📰</div>
      <h2 className="text-xl font-semibold text-gray-400">まだ記事がありません</h2>
      <p className="mt-2 text-sm text-gray-600">
        パイプラインを実行して記事を取得・要約してください
      </p>
      <code className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-xs text-blue-400">
        docker compose run --rm frontend npx tsx scripts/sync-news.ts
      </code>
    </div>
  );
}

/**
 * 記事1件分のカードコンポーネント。
 *
 * @param article - 表示する記事データ
 * @param index - カードのインデックス（アニメーション遅延に使用）
 */
function ArticleCard({ article }: { article: ArticleCard }) {
  const summaryLines = article.summary ? parseSummaryLines(article.summary) : [];

  return (
    // group クラスでホバー時の子要素スタイル変更を可能にする
    <article className="group relative flex flex-col rounded-xl border border-gray-800 bg-gray-900/60 p-6 backdrop-blur-sm transition-all duration-200 hover:border-blue-500/40 hover:bg-gray-900/80 hover:shadow-lg hover:shadow-blue-500/5">

      {/* ── ソース＆日時 ───────────────────────────── */}
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400 ring-1 ring-blue-500/20">
          {/* ソースが長い場合は省略する */}
          {article.source ?? 'Unknown'}
        </span>
        <time className="text-xs text-gray-600" dateTime={article.publishedAt?.toISOString()}>
          {formatDate(article.publishedAt)}
        </time>
      </div>

      {/* ── タイトル ──────────────────────────────── */}
      <h2 className="mb-4 text-base font-bold leading-snug text-gray-100 group-hover:text-white">
        {article.title}
      </h2>

      {/* ── AI 要約 ───────────────────────────────── */}
      {summaryLines.length > 0 && (
        <div className="mb-5 flex-1">
          {/* 左のアクセントラインで「AI生成コンテンツ」であることを視覚的に示す */}
          <div className="border-l-2 border-blue-500/50 pl-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-blue-500/70">
              AI Summary
            </p>
            <ul className="space-y-1.5">
              {summaryLines.map((line, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-gray-400">
                  {/* 箇条書きのドット */}
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500/50" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── 元記事リンク ──────────────────────────── */}
      <div className="mt-auto pt-4 border-t border-gray-800">
        <a
          href={article.url}
          target="_blank"       // 新しいタブで開く
          rel="noopener noreferrer" // セキュリティ: opener の参照を渡さない
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-blue-400"
        >
          元記事を読む
          {/* 外部リンクアイコン (SVG) */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </article>
  );
}

// --- ページ本体 ---

/**
 * AI要約ニュース一覧ページ。
 * Next.js Server Component として実装することで、
 * クライアントに Prisma クライアントを送らずにサーバー側でDB取得できる。
 */
export default async function Home() {
  const articles = await getSummarizedArticles();

  return (
    <div className="min-h-screen">
      {/* ── ヘッダー ──────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-gray-800/60 bg-[#080810]/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* ロゴアイコン */}
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-bold text-white">AI Tech News</h1>
                <p className="text-[10px] text-gray-500">Powered by Gemini AI</p>
              </div>
            </div>
            {/* 件数バッジ */}
            <span className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-400">
              {articles.length} 件
            </span>
          </div>
        </div>
      </header>

      {/* ── メインコンテンツ ─────────────────────── */}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">

        {/* ページタイトル */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white">
            最新のテックニュース
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            TypeScript・React・Python など注目技術の最新動向を Gemini AI が3行で要約
          </p>
        </div>

        {/* 記事一覧 or エンプティステート */}
        {articles.length === 0 ? (
          <EmptyState />
        ) : (
          // レスポンシブ: モバイル1列 → タブレット2列 → デスクトップ3列
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )}
      </main>

      {/* ── フッター ──────────────────────────────── */}
      <footer className="mt-16 border-t border-gray-800/60 py-8 text-center text-xs text-gray-700">
        AI Tech News — summarized by Gemini AI
      </footer>
    </div>
  );
}
