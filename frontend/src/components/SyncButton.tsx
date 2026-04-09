'use client';

// --- ニュース同期ボタン ---
// 「今すぐ取得」と「全件処理」の2ボタンを持つ Client Component。
//
// 「今すぐ取得」: News API 取得 → 1件要約（Gemini レート制限対策でデフォルト1件）
// 「全件処理」  : pending 記事を全件まとめて要約（時間がかかるが一括で完結する）

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// --- 型定義 ---

/** POST /api/sync の成功レスポンス型 */
interface SyncResult {
  newArticles: number;
  summarizedTitle: string | null;
  message: string;
}

/** POST /api/sync/batch の成功レスポンス型 */
interface BatchSyncResult {
  processed: number;
  errors: number;
  titles: string[];
  message: string;
}

// --- コンポーネント ---

/**
 * ニュース取得・要約パイプラインをトリガーするボタンコンポーネント。
 */
export default function SyncButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBatching, setIsBatching] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // C# の INavigationService に相当
  const router = useRouter();

  // --- 1件取得処理 ---

  /**
   * 「今すぐ取得」クリックハンドラ。
   * POST /api/sync を呼び出して News API 取得 → 1件要約を実行する。
   */
  async function handleSync() {
    if (isSyncing || isBatching) return;
    setIsSyncing(true);
    setStatusMessage(null);
    setIsError(false);

    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data: SyncResult | { error: string } = await res.json();

      if (!res.ok) {
        const errorMsg = 'error' in data ? data.error : '不明なエラー';
        setStatusMessage(`エラー: ${errorMsg}`);
        setIsError(true);
        return;
      }

      setStatusMessage((data as SyncResult).message);
      router.refresh(); // サーバーコンポーネントを再レンダリングして記事一覧を更新
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMessage(`ネットワークエラー: ${message}`);
      setIsError(true);
    } finally {
      setIsSyncing(false);
    }
  }

  // --- 全件処理 ---

  /**
   * 「全件処理」クリックハンドラ。
   * POST /api/sync/batch を呼び出して pending 記事を全件要約する。
   * Gemini レート制限のため記事1件あたり約5秒かかる。
   */
  async function handleBatch() {
    if (isSyncing || isBatching) return;
    setIsBatching(true);
    setStatusMessage('全件処理中... しばらくお待ちください');
    setIsError(false);

    try {
      const res = await fetch('/api/sync/batch', { method: 'POST' });
      const data: BatchSyncResult | { error: string } = await res.json();

      if (!res.ok) {
        const errorMsg = 'error' in data ? data.error : '不明なエラー';
        setStatusMessage(`エラー: ${errorMsg}`);
        setIsError(true);
        return;
      }

      setStatusMessage((data as BatchSyncResult).message);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatusMessage(`ネットワークエラー: ${message}`);
      setIsError(true);
    } finally {
      setIsBatching(false);
    }
  }

  const isAnyLoading = isSyncing || isBatching;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {/* 全件処理ボタン */}
        <button
          onClick={handleBatch}
          disabled={isAnyLoading}
          title="pending 記事を全件まとめて要約する（記事数×5秒程度かかります）"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-blue-500/40 hover:bg-gray-700/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBatching ? (
            <>
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              処理中...
            </>
          ) : (
            <>
              {/* スタックアイコン */}
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
              全件処理
            </>
          )}
        </button>

        {/* 今すぐ取得ボタン */}
        <button
          onClick={handleSync}
          disabled={isAnyLoading}
          title="News API から記事を取得して1件要約する"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSyncing ? (
            <>
              <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              取得中...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              今すぐ取得
            </>
          )}
        </button>
      </div>

      {/* 実行結果メッセージ */}
      {statusMessage && (
        <p className={`text-xs ${isError ? 'text-red-400' : 'text-green-400'}`}>
          {statusMessage}
        </p>
      )}
    </div>
  );
}
