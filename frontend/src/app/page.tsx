// --- トップページ: AI要約ニュース一覧 ---
// Next.js 14 Server Component として実装する。
// サーバー側で Prisma を直接呼び出せるため、APIルートを挟まずにDBから取得できる。
// これにより余分なネットワークラウンドトリップを排除し、初期表示を高速化できる。

import { prisma } from '../../lib/db';
import SyncButton from '../components/SyncButton';
import ArticleList, { type ArticleItem } from '../components/ArticleList';

// --- データ取得 ---

/**
 * status が "summarized" の記事を公開日時の新しい順に取得する。
 *
 * @returns 表示用記事リスト（最大50件）
 */
async function getSummarizedArticles(): Promise<ArticleItem[]> {
  const articles = await prisma.article.findMany({
    where: { status: 'summarized' },
    orderBy: { publishedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      titleJa: true,
      summary: true,
      url: true,
      source: true,
      publishedAt: true,
    },
  });

  // Date を ISO 文字列にシリアライズする。
  // Server Component から Client Component へ Date オブジェクトを渡す際、
  // Next.js のシリアライズ境界で型エラーが起きるため文字列に変換する。
  return articles.map((a) => ({
    ...a,
    publishedAt: a.publishedAt?.toISOString() ?? null,
  }));
}

/**
 * status が "pending" の記事件数を取得する。
 * ヘッダーの未処理バッジに使用する。
 *
 * @returns 未処理記事の件数
 */
async function getPendingCount(): Promise<number> {
  return prisma.article.count({
    where: { status: 'pending' },
  });
}

// --- コンポーネント ---

/**
 * 記事が0件のときに表示するエンプティステート。
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="mb-4 text-6xl opacity-20">📰</div>
      <h2 className="text-xl font-semibold text-gray-400">まだ記事がありません</h2>
      <p className="mt-2 text-sm text-gray-600">
        ヘッダーの「今すぐ取得」ボタンで記事を取得・要約してください
      </p>
    </div>
  );
}

// --- ページ本体 ---

/**
 * AI要約ニュース一覧ページ。
 */
export default async function Home() {
  // 記事一覧と pending 件数を並列で取得することで、
  // 直列取得に比べてレスポンスタイムを短縮する。
  // C# の Task.WhenAll に相当
  const [articles, pendingCount] = await Promise.all([
    getSummarizedArticles(),
    getPendingCount(),
  ]);

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

            {/* 右側: バッジ群＋取得ボタン */}
            <div className="flex items-center gap-3">
              {/* 要約済み件数 */}
              <span className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-400">
                {articles.length} 件
              </span>
              {/* 未処理件数バッジ（pending が0件の場合は非表示） */}
              {pendingCount > 0 && (
                <span className="rounded-full bg-yellow-500/15 px-3 py-1 text-xs font-medium text-yellow-400 ring-1 ring-yellow-500/30">
                  未処理 {pendingCount} 件
                </span>
              )}
              <SyncButton />
            </div>
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
          <ArticleList articles={articles} />
        )}
      </main>

      {/* ── フッター ──────────────────────────────── */}
      <footer className="mt-16 border-t border-gray-800/60 py-8 text-center text-xs text-gray-700">
        AI Tech News — summarized by Gemini AI
      </footer>
    </div>
  );
}
