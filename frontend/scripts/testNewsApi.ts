// --- News API 取得 → DB 保存 動作確認スクリプト ---
// 目的: newsApi.ts の fetchTopHeadlines と Prisma の upsert が
//       実際に連携して動作するかをローカル環境で素早く検証する。
//
// 実行方法:
//   docker compose run --rm frontend npx tsx scripts/testNewsApi.ts
//
// 前提: docker compose up -d db でDBが起動済みであること。

import { PrismaClient } from '@prisma/client';
import { fetchTopHeadlines } from '../lib/newsApi';

// --- メイン処理 ---

/**
 * News API から記事を取得し、DB に pending ステータスで保存する。
 *
 * upsert を使う理由:
 * News API は同一記事を複数回返すことがある（CLAUDE.md §2-3参照）。
 * url を一意キーとして upsert することで、重複実行しても
 * 既存レコードを上書きせず安全に冪等性を保てる。
 *
 * @returns なし（結果は標準出力に出力）
 * @throws {Error} DB 接続失敗 または News API 呼び出し失敗時
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient(); // C# の using var context = new AppDbContext() に相当

  try {
    console.log('=== News API 取得テスト開始 ===\n');

    // --- 記事取得 ---
    console.log('[1/3] News API から記事を取得中...');
    const articles = await fetchTopHeadlines('jp', 5);
    console.log(`      → ${articles.length} 件取得しました\n`);

    // --- DB 保存 ---
    console.log('[2/3] DB に保存中 (ステータス: pending)...');

    let savedCount = 0;
    let skippedCount = 0;

    for (const article of articles) {
      // upsert の前に存在確認することで新規/既存を正確に判別する。
      // update: {} の upsert は @updatedAt を更新しないため
      // createdAt/updatedAt 比較では判定できないことへの対処。
      const existing = await prisma.article.findUnique({
        where: { url: article.url },
      });

      await prisma.article.upsert({
        where: { url: article.url },
        // 既存レコードは更新しない。
        // ステータスが summarized や posted に進んでいる記事を
        // 再取得で pending に戻さないようにするため。
        update: {},
        create: {
          title: article.title,
          url: article.url,
          content: article.content,
          source: article.source,
          imageUrl: article.imageUrl,
          publishedAt: article.publishedAt,
          status: 'pending', // 取得直後は未処理状態で保存（CLAUDE.md §4-2）
        },
      });

      if (existing) {
        skippedCount++;
        console.log(`      [スキップ] ${article.title} (既存レコード)`);
      } else {
        savedCount++;
        console.log(`      [新規] ${article.title}`);
      }
    }

    console.log(
      `\n      → 新規保存: ${savedCount} 件 / スキップ: ${skippedCount} 件\n`
    );

    // --- 保存確認 ---
    console.log('[3/3] DB の pending 記事を確認中...');
    const pendingArticles = await prisma.article.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        status: true,
        source: true,
        createdAt: true,
      },
    });

    console.log(`\n--- DB内の pending 記事 (最新5件) ---`);
    for (const a of pendingArticles) {
      console.log(
        `  id: ${a.id} | [${a.status}] ${a.title} (${a.source ?? '不明'})`
      );
    }

    console.log('\n=== テスト完了 ✓ ===');
  } finally {
    // finally で必ず切断することで、コネクションリークを防ぐ。
    // C# の using ブロックによる自動 Dispose に相当する後処理。
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n[エラー] テスト中に例外が発生しました:', err);
  process.exit(1);
});
