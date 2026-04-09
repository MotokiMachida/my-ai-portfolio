// --- 全件一括処理 API ルート ---
// POST /api/sync/batch を受け取ると、pending 状態の記事を全件処理する。
// フロントエンドの「全件処理」ボタンから呼び出される。
//
// 1件ずつ逐次処理する理由:
// Gemini 無料枠のレート制限（約15リクエスト/分）を超えないよう、
// 各記事の処理後に DELAY_MS だけ待機してから次の記事に進む。
// 並列処理にすると即座に 429 エラーになるため採用しない。

import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { summarizeArticle } from '../../../../../lib/gemini';
import { scrapeArticleContent } from '../../../../../lib/scraper';

// Gemini 無料枠のレート制限対策。
// 1リクエストあたり最低この間隔を空ける（ミリ秒）。
// 15 req/min = 4000ms/req が理論値だが、安全マージンを取って 5000ms にする。
const DELAY_MS = 5000;

/**
 * 指定ミリ秒だけ待機する。
 * C# の Task.Delay に相当。
 *
 * @param ms - 待機時間（ミリ秒）
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- 型定義 ---

/**
 * 一括処理の結果を表す型。
 */
interface BatchSyncResult {
  /** 処理完了した記事数 */
  processed: number;
  /** エラーになった記事数 */
  errors: number;
  /** 要約完了した記事タイトル（日本語）のリスト */
  titles: string[];
  /** 完了メッセージ */
  message: string;
  /** Gemini 無料枠上限に達したか */
  quotaExceeded?: boolean;
}

// --- POSTハンドラ ---

/**
 * pending 記事を全件処理する Route Handler。
 *
 * 全件処理後に要約済み件数・エラー件数・処理タイトル一覧を返す。
 * 1件処理するごとに DELAY_MS 待機してレート制限を回避する。
 *
 * @returns BatchSyncResult を含む JSON レスポンス
 */
export async function POST(): Promise<NextResponse> {
  // 処理開始前に全 pending 記事を取得する。
  // 処理中に新たに pending になった記事は次回実行時に処理する設計にすることで、
  // 無限ループやタイムアウトを防ぐ。
  const pendingArticles = await prisma.article.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });

  if (pendingArticles.length === 0) {
    const result: BatchSyncResult = {
      processed: 0,
      errors: 0,
      titles: [],
      message: 'pending 記事はありませんでした。',
    };
    return NextResponse.json(result);
  }

  let processed = 0;
  let errors = 0;
  const titles: string[] = [];

  for (let i = 0; i < pendingArticles.length; i++) {
    const target = pendingArticles[i];

    try {
      // ── スクレイピング ──────────────────────────────────────────────
      const scrapedContent = await scrapeArticleContent(target.url);

      let contentForSummary: string | null;
      if (scrapedContent) {
        contentForSummary = scrapedContent;
        await prisma.article.update({
          where: { id: target.id },
          data: { content: scrapedContent },
        });
      } else {
        contentForSummary = target.content;
      }

      // ── Gemini 要約 ────────────────────────────────────────────────
      const result = await summarizeArticle(target.title, contentForSummary);

      // ── DB 更新 ────────────────────────────────────────────────────
      await prisma.article.update({
        where: { id: target.id },
        data: {
          titleJa: result.titleJa,
          summary: result.summary,
          status: 'summarized',
        },
      });

      processed++;
      titles.push(result.titleJa);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // 429 (RESOURCE_EXHAUSTED) は Gemini の無料枠上限到達を意味する。
      // 残りの記事は status を変えずに pending のまま残し、処理を中断する。
      // エラー記事として汚染しないことで、翌日以降に再実行できる状態を保つ。
      if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')) {
        const remaining = pendingArticles.length - i;
        const batchResult: BatchSyncResult = {
          processed,
          errors,
          titles,
          message: `⚠️ Gemini 無料枠(20件/日)に達しました。${processed}件処理済み、残り${remaining}件は明日以降に実行してください。`,
          quotaExceeded: true,
        };
        return NextResponse.json(batchResult);
      }

      // 429 以外のエラーはスキップして次の記事を処理する。
      // 1件のエラーでバッチ全体を止めないための設計。
      await prisma.article.update({
        where: { id: target.id },
        data: { status: 'error', errorMessage: message.slice(0, 500) },
      });
      errors++;
    }

    // 最後の記事以外は待機してレート制限を回避する
    if (i < pendingArticles.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  const batchResult: BatchSyncResult = {
    processed,
    errors,
    titles,
    message: `完了: ${processed}件を要約しました。${errors > 0 ? `（${errors}件はエラー）` : ''}`,
  };

  return NextResponse.json(batchResult);
}
