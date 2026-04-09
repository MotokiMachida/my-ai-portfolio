// --- ニュース同期パイプライン ---
// 以下の一連の処理を順番に実行するエントリーポイントスクリプト。
//
//   [Step 1]   News API からテックニュースを取得
//       ↓
//   [Step 2]   DB に upsert（status: pending で保存、重複はスキップ）
//       ↓
//   [Step 3]   pending 記事を 1 件取得
//       ↓
//   [Step 3.5] 元記事 URL をスクレイピングして全文取得（失敗時は部分テキストで代替）
//       ↓
//   [Step 4]   Gemini で要約（スクレイピング全文 or 部分テキストを使用）
//       ↓
//   [Step 5]   DB を更新（全文・summary 保存、status: summarized に変更）
//
// 実行方法:
//   docker compose run --rm frontend npx tsx scripts/sync-news.ts
//
// 前提: docker compose up -d db でDBが起動済みで、
//       .env に NEWS_API_KEY と GEMINI_API_KEY が設定済みであること。

import { PrismaClient } from '@prisma/client';
import { fetchTechNews } from '../lib/newsApi';
import { summarizeArticle } from '../lib/gemini';
import { scrapeArticleContent } from '../lib/scraper';

// --- メイン処理 ---

/**
 * ニュース取得 → DB保存 → AI要約 → DB更新 のパイプラインを実行する。
 *
 * 各ステップを分離して実装する理由:
 * ステップ単位で失敗を検知・ログ出力でき、
 * どのフェーズで問題が起きたかをすぐ特定できる。
 * また将来的に各ステップを独立したジョブに分割しやすくなる。
 *
 * @returns なし（結果は標準出力に出力）
 * @throws {Error} 各ステップで回復不能なエラーが発生した場合
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    console.log('╔══════════════════════════════════════╗');
    console.log('║  ニュース同期パイプライン 開始        ║');
    console.log('╚══════════════════════════════════════╝\n');

    // ── Step 1: News API からテックニュースを取得 ──────────────────────
    console.log('【Step 1】 News API からテックニュースを取得中...');
    const articles = await fetchTechNews(10);
    console.log(`  → ${articles.length} 件取得完了\n`);

    // ── Step 2: DB に upsert（pending で保存） ─────────────────────────
    console.log('【Step 2】 DB に保存中 (status: pending)...');

    let newCount = 0;
    let skipCount = 0;

    for (const article of articles) {
      // 事前に存在確認することで新規/既存を正確に判別する。
      // upsert の update:{} だけでは @updatedAt の更新有無で判定できないため。
      const existing = await prisma.article.findUnique({
        where: { url: article.url },
      });

      await prisma.article.upsert({
        where: { url: article.url },
        // 既存レコードは更新しない。
        // summarized/posted に進んだ記事を pending に巻き戻さないための設計。
        update: {},
        create: {
          title: article.title,
          url: article.url,
          content: article.content,
          source: article.source,
          imageUrl: article.imageUrl,
          publishedAt: article.publishedAt,
          status: 'pending',
        },
      });

      if (existing) {
        skipCount++;
      } else {
        newCount++;
        console.log(`  [新規] ${article.title}`);
      }
    }

    console.log(`  → 新規: ${newCount} 件 / スキップ（既存）: ${skipCount} 件\n`);

    // ── Step 3: pending 記事を 1 件取得 ───────────────────────────────
    console.log('【Step 3】 pending 記事を 1 件取得中...');

    const target = await prisma.article.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' }, // 最も古い未処理記事から順に処理する
    });

    if (!target) {
      console.log('  pending 記事が見つかりませんでした。処理終了。');
      return;
    }

    console.log(`  → 対象: ${target.title}\n`);

    // ── Step 3.5: 元記事URLから本文をスクレイピング ───────────────────
    // News API 無料プランは本文を先頭200文字程度しか返さない。
    // 要約品質を高めるため元ページにアクセスして全文を取得する。
    // 失敗した場合は News API の部分テキストにフォールバックする。
    console.log('【Step 3.5】 元記事の本文をスクレイピング中...');
    const scrapedContent = await scrapeArticleContent(target.url);

    let contentForSummary: string | null;
    if (scrapedContent) {
      console.log(`  → スクレイピング成功 (${scrapedContent.length}文字)\n`);
      contentForSummary = scrapedContent;

      // スクレイピングで取得した本文を DB に保存する。
      // 次回の再実行時に再スクレイピングせずに済むようにするための永続化。
      await prisma.article.update({
        where: { id: target.id },
        data: { content: scrapedContent },
      });
    } else {
      console.log(`  → スクレイピング失敗。News API の部分テキストで代替します\n`);
      contentForSummary = target.content;
    }

    // ── Step 4: Gemini で要約 ──────────────────────────────────────────
    console.log('【Step 4】 Gemini で要約中...');

    let result: { titleJa: string; summary: string };
    try {
      result = await summarizeArticle(target.title, contentForSummary);
      console.log(`  → 要約生成完了\n`);
      console.log(`  日本語タイトル: ${result.titleJa}`);
    } catch (err) {
      // 要約失敗時は error ステータスに更新して処理を終了する。
      // エラー内容を DB に保存することで、次回実行時に原因を確認できる。
      const message = err instanceof Error ? err.message : String(err);
      await prisma.article.update({
        where: { id: target.id },
        data: { status: 'error', errorMessage: message.slice(0, 500) },
      });
      throw err;
    }

    // ── Step 5: DB 更新（summarized に変更） ──────────────────────────
    console.log('\n【Step 5】 DB を更新中 (status: summarized)...');

    const updated = await prisma.article.update({
      where: { id: target.id },
      data: {
        titleJa: result.titleJa,
        summary: result.summary,
        status: 'summarized',
      },
    });

    console.log('  → DB 更新完了\n');

    // ── 最終結果の表示 ─────────────────────────────────────────────────
    console.log('╔══════════════════════════════════════╗');
    console.log('║  パイプライン完了 ✓                  ║');
    console.log('╚══════════════════════════════════════╝\n');
    console.log(`元タイトル    : ${updated.title}`);
    console.log(`日本語タイトル: ${updated.titleJa}`);
    console.log(`ステータス    : ${updated.status}`);
    console.log(`ソース        : ${updated.source ?? '不明'}`);
    console.log(`\n── 生成された要約 ──`);
    updated.summary?.split('\n').forEach((line) => console.log(`  ${line}`));
    console.log(`────────────────────`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n[エラー] パイプライン実行中に例外が発生しました:', err);
  process.exit(1);
});
