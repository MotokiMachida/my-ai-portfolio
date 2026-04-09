// --- 記事操作 API ルート ---
// DELETE /api/articles: 指定した記事IDを一括削除する。
// フロントエンドの削除ボタンから呼び出される。

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

// --- 型定義 ---

/**
 * DELETE リクエストのボディ型。
 * 削除対象の記事IDリストを受け取る。
 */
interface DeleteRequestBody {
  ids: string[];
}

// --- DELETEハンドラ ---

/**
 * 指定された記事を一括削除する Route Handler。
 *
 * deleteMany を使う理由:
 * 1件ずつ delete を呼ぶより 1回のDBクエリで完結するため効率的。
 * また、一部のIDが存在しない場合でも他の削除に影響しない。
 *
 * @param request - 削除対象IDリストを含む JSON リクエスト
 * @returns 削除件数を含む JSON レスポンス
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const body: DeleteRequestBody = await request.json();
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: '削除対象のIDが指定されていません' },
        { status: 400 }
      );
    }

    const result = await prisma.article.deleteMany({
      where: { id: { in: ids } },
    });

    return NextResponse.json({ deleted: result.count });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
