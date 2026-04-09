'use client';

// --- ニュース同期ボタン ---
// 「今すぐ取得」ボタンをクリックすると /api/sync を叩いてパイプラインを1回実行する。
//
// Client Component として実装する理由:
// ボタンのクリックイベントや loading 状態の管理には useState/useRouter が必要なため。
// データ取得自体はサーバーサイド（route.ts）が担い、
// このコンポーネントはUI状態のみを管理する（責務分離）。

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// --- 型定義 ---

/**
 * /api/sync の成功レスポンス型。
 * route.ts の SyncResult と対応させる。
 */
interface SyncResult {
  newArticles: number;
  summarizedTitle: string | null;
  message: string;
}

// --- コンポーネント ---

/**
 * ニュース取得・要約パイプラインをトリガーするボタンコンポーネント。
 *
 * クリック時の動作:
 * 1. ローディング状態に切り替え（連打防止）
 * 2. POST /api/sync を呼び出してパイプラインを1件実行
 * 3. 完了後、router.refresh() でサーバーから最新データを再取得して表示を更新
 * 4. 成功・失敗メッセージをボタン下に表示
 */
export default function SyncButton() {
  // ローディング状態: true の間はボタンを無効化して連打を防ぐ
  const [isLoading, setIsLoading] = useState(false);

  // 最後の実行結果メッセージ（成功・失敗どちらも格納）
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // エラーかどうかでメッセージの色を変えるためのフラグ
  const [isError, setIsError] = useState(false);

  // router.refresh() でサーバーコンポーネントを再レンダリングさせる
  // C# の StateHasChanged() に相当
  const router = useRouter();

  /**
   * 「今すぐ取得」ボタンのクリックハンドラ。
   * POST /api/sync を呼び出し、結果をステートに反映する。
   */
  async function handleSync() {
    setIsLoading(true);
    setStatusMessage(null);
    setIsError(false);

    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data: SyncResult | { error: string } = await res.json();

      if (!res.ok) {
        // APIがエラーステータスを返した場合
        const errorMsg = 'error' in data ? data.error : '不明なエラーが発生しました';
        setStatusMessage(`エラー: ${errorMsg}`);
        setIsError(true);
        return;
      }

      const result = data as SyncResult;
      setStatusMessage(result.message);
      setIsError(false);

      // サーバーコンポーネント（page.tsx）を再レンダリングして最新記事を表示する。
      // router.refresh() は Next.js のキャッシュを無効化してサーバーから再取得する。
      router.refresh();
    } catch (err) {
      // ネットワークエラーなど fetch 自体が失敗した場合
      const message = err instanceof Error ? err.message : String(err);
      setStatusMessage(`ネットワークエラー: ${message}`);
      setIsError(true);
    } finally {
      // 成功・失敗いずれの場合もローディングを解除する
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {/* 取得ボタン */}
      <button
        onClick={handleSync}
        disabled={isLoading}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? (
          <>
            {/* スピナーアイコン (SVG) */}
            <svg
              className="h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            取得中...
          </>
        ) : (
          <>
            {/* 更新アイコン (SVG) */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            今すぐ取得
          </>
        )}
      </button>

      {/* 実行結果メッセージ */}
      {statusMessage && (
        <p
          className={`text-xs ${
            isError ? 'text-red-400' : 'text-green-400'
          }`}
        >
          {statusMessage}
        </p>
      )}
    </div>
  );
}
