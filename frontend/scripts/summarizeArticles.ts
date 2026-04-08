// --- pending 記事一括要約スクリプト ---
// 目的: DB内の pending 記事を Gemini 1.5 Flash で要約し、
//       summary カラムを更新してステータスを summarized に変える。
//
// 実行方法:
//   # 1件だけ処理（デフォルト / テスト用）
//   docker compose run --rm frontend npx tsx scripts/summarizeArticles.ts
//
//   # 件数を指定して処理
//   docker compose run --rm frontend npx tsx scripts/summarizeArticles.ts --limit 5
//
//   # pending 記事をすべて処理
//   docker compose run --rm frontend npx tsx scripts/summarizeArticles.ts --all
//
// 前提: docker compose up -d db でDBが起動済みかつ GEMINI_API_KEY が .env に設定済みであること。

import { PrismaClient } from '@prisma/client';
import { summarizeArticle } from '../lib/gemini';

// --- 引数パース ---

/**
 * コマンドライン引数を解析して処理件数の上限を返す。
 *
 * デフォルトを 1 件にする理由:
 * Gemini API には無料枠のレート制限がある。
 * 誤って大量実行してしまうリスクを避けるため、
 * 明示的な指定がない場合は最小単位でのテストを促す設計とする。
 *
 * @returns 処理件数の上限（--all 指定時は undefined = 無制限）
 */
function parseLimit(): number | undefined {
  const args = process.argv.slice(2); // C# の args[] に相当
  if (args.includes('--all')) return undefined;

  const limitIndex = args.indexOf('--limit');
  if (limitIndex !== -1 && args[limitIndex + 1]) {
    const parsed = parseInt(args[limitIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // デフォルト: 1件（テスト・動作確認用）
  return 1;
}

// --- メイン処理 ---

/**
 * DB内の pending 記事を取得し、Gemini で要約して summarized ステータスに更新する。
 *
 * エラーハンドリング方針:
 * 1件の要約失敗で全体を止めないよう、記事単位で try/catch する。
 * 失敗した記事は status='error' + errorMessage に更新し、
 * 次回実行時に再試行できる状態にする（CLAUDE.md §4-2）。
 *
 * @returns なし（結果は標準出力に出力）
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const limit = parseLimit();

  try {
    console.log('=== Gemini 一括要約スクリプト開始 ===');
    console.log(
      `処理件数: ${limit !== undefined ? `${limit}件` : '全件（--all）'}\n`
    );

    // --- pending 記事取得 ---
    const articles = await prisma.article.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' }, // 古い記事から順に処理する
      ...(limit !== undefined ? { take: limit } : {}),
      select: {
        id: true,
        title: true,
        content: true,
        url: true,
      },
    });

    if (articles.length === 0) {
      console.log('処理対象の pending 記事がありません。');
      return;
    }

    console.log(`[1/2] ${articles.length} 件の pending 記事を取得しました\n`);
    console.log('[2/2] Gemini で要約中...\n');

    let successCount = 0;
    let errorCount = 0;

    for (const article of articles) {
      console.log(`  処理中: ${article.title}`);

      try {
        const summary = await summarizeArticle(article.title, article.content);

        // 要約成功 → summary を保存してステータスを summarized に更新
        await prisma.article.update({
          where: { id: article.id },
          data: {
            summary,
            status: 'summarized',
          },
        });

        successCount++;
        console.log(`  ✓ 要約完了\n`);
        console.log('  --- 生成された要約 ---');
        // インデントをつけて要約内容を見やすく表示する
        summary.split('\n').forEach((line) => console.log(`  ${line}`));
        console.log('  ----------------------\n');

        // Gemini の無料枠レート制限（15 RPM）に対応するため、
        // 複数件処理時は1秒のウェイトを入れる。
        if (articles.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000)); // C# の Task.Delay に相当
        }
      } catch (err) {
        errorCount++;
        const errorMessage =
          err instanceof Error ? err.message : String(err);

        // 要約失敗 → error ステータスに更新し、次回再試行できる状態にする
        await prisma.article.update({
          where: { id: article.id },
          data: {
            status: 'error',
            errorMessage: errorMessage.slice(0, 500), // DB カラム長の安全策
          },
        });

        console.error(`  ✗ エラー: ${errorMessage}\n`);
      }
    }

    // --- 結果サマリー ---
    console.log('=== 処理完了 ===');
    console.log(`  成功: ${successCount} 件`);
    console.log(`  失敗: ${errorCount} 件`);

    if (successCount > 0) {
      // 処理結果の確認用に summarized 記事の最新1件を表示する
      const sample = await prisma.article.findFirst({
        where: { status: 'summarized' },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, status: true, summary: true },
      });
      if (sample) {
        console.log(`\n--- DB確認: 最新のsummarized記事 ---`);
        console.log(`  id: ${sample.id}`);
        console.log(`  title: ${sample.title}`);
        console.log(`  status: ${sample.status}`);
        console.log(`  summary: ${sample.summary?.slice(0, 100)}...`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n[エラー] スクリプト実行中に例外が発生しました:', err);
  process.exit(1);
});
