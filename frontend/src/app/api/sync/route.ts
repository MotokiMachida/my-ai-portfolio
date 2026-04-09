// --- ニュース同期 API ルート ---
// POST /api/sync を受け取ると、ニュース取得→DB保存→AI要約パイプラインを1回実行する。
// フロントエンドの「今すぐ取得」ボタンから呼び出される。
//
// Next.js Route Handler として実装する理由:
// Server Actions でも実現できるが、Route Handler にしておくと
// curl やスケジューラからも叩けるため運用の柔軟性が高い。

import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';
import { fetchTechNews } from '../../../../lib/newsApi';
import { summarizeArticle } from '../../../../lib/gemini';
import { scrapeArticleContent } from '../../../../lib/scraper';

// --- 型定義 ---

/**
 * パイプラインの実行結果を表す型。
 * クライアントへのレスポンスに使用する。
 */
interface SyncResult {
  /** 今回新規保存した記事数 */
  newArticles: number;
  /** 今回要約した記事タイトル（日本語）。処理対象がなければ null */
  summarizedTitle: string | null;
  /** 全体的なステータス説明 */
  message: string;
}

// --- POSTハンドラ ---

/**
 * ニュース同期パイプラインを1サイクル実行する Route Handler。
 *
 * 1サイクルの処理:
 *   Step 1: News API から最新記事を取得（最大10件）
 *   Step 2: 新規記事を DB に pending で保存
 *   Step 3: pending 記事を 1 件取得
 *   Step 4: 元記事をスクレイピングして全文を取得
 *   Step 5: Gemini で日本語タイトルと要約を生成
 *   Step 6: DB を summarized に更新
 *
 * 1件ずつ処理する理由:
 * Gemini 無料枠のレート制限を超えないよう、ボタン1クリック=1記事要約に抑える。
 * pending が残っていれば次回クリックで続きを処理できる。
 *
 * @returns SyncResult を含む JSON レスポンス
 */
export async function POST(): Promise<NextResponse> {
  try {
    // ── Step 1: News API から取得 ──────────────────────────────────────
    const articles = await fetchTechNews(10);

    // ── Step 2: DB に upsert（既存記事はスキップ） ──────────────────────
    let newCount = 0;

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

      if (!existing) {
        newCount++;
      }
    }

    // ── Step 3: pending 記事を 1 件取得 ───────────────────────────────
    const target = await prisma.article.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' }, // 最も古い未処理記事から順に処理する
    });

    if (!target) {
      const result: SyncResult = {
        newArticles: newCount,
        summarizedTitle: null,
        message: `${newCount} 件取得しましたが、pending 記事はありませんでした。`,
      };
      return NextResponse.json(result);
    }

    // ── Step 4: 元記事URLから本文をスクレイピング ─────────────────────
    const scrapedContent = await scrapeArticleContent(target.url);

    let contentForSummary: string | null;
    if (scrapedContent) {
      contentForSummary = scrapedContent;
      // スクレイピングで取得した本文をDBに保存しておく。
      // 次回の再実行時に再スクレイピングせずに済む。
      await prisma.article.update({
        where: { id: target.id },
        data: { content: scrapedContent },
      });
    } else {
      contentForSummary = target.content;
    }

    // ── Step 5: Gemini で要約 ──────────────────────────────────────────
    let titleJa: string;
    let summary: string;

    try {
      const result = await summarizeArticle(target.title, contentForSummary);
      titleJa = result.titleJa;
      summary = result.summary;
    } catch (err) {
      // 要約失敗時はエラーステータスに更新し、再試行可能な状態に保つ。
      const message = err instanceof Error ? err.message : String(err);
      await prisma.article.update({
        where: { id: target.id },
        data: { status: 'error', errorMessage: message.slice(0, 500) },
      });
      throw err;
    }

    // ── Step 6: DB 更新（summarized に変更） ──────────────────────────
    await prisma.article.update({
      where: { id: target.id },
      data: {
        titleJa,
        summary,
        status: 'summarized',
      },
    });

    const syncResult: SyncResult = {
      newArticles: newCount,
      summarizedTitle: titleJa,
      message: `完了: 「${titleJa}」を要約しました。`,
    };

    return NextResponse.json(syncResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
