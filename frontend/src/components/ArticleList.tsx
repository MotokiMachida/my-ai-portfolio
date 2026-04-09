'use client';

// --- 記事一覧コンポーネント ---
// 検索フィルター・チェックボックス選択・一括削除の3機能を持つ Client Component。
//
// Client Component として実装する理由:
// チェックボックスの選択状態・検索テキスト・削除中フラグ等の
// インタラクティブな状態管理に useState/useMemo が必要なため。
// データ取得は Server Component (page.tsx) が担い、このコンポーネントはUI状態のみを管理する。

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

// --- 型定義 ---

/**
 * サーバーから受け取る記事データの型。
 * Date は JSON シリアライズの都合で ISO 文字列として受け取る。
 */
export type ArticleItem = {
  id: string;
  title: string;
  titleJa: string | null;
  summary: string | null;
  url: string;
  source: string | null;
  publishedAt: string | null; // ISO 8601 文字列（Date をそのまま渡すと型エラーになるため）
};

// --- ユーティリティ ---

/**
 * ISO 文字列を日本語の相対時間または絶対日時文字列に変換する。
 * 24時間以内は「N時間前」、それ以降は「YYYY年M月D日」形式で返す。
 *
 * @param isoString - 変換対象の ISO 8601 文字列（null の場合は "日時不明" を返す）
 * @returns フォーマット済みの日時文字列
 */
function formatDate(isoString: string | null): string {
  if (!isoString) return '日時不明';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) return 'たった今';
  if (diffHours < 24) return `${diffHours}時間前`;

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
 *
 * @param summary - Geminiが生成した要約テキスト
 * @returns 表示用の文字列配列
 */
function parseSummaryLines(summary: string): string[] {
  return summary
    .split('\n')
    .map((line) => line.replace(/^[-・]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

// --- サブコンポーネント ---

/**
 * 記事1件分のカードコンポーネント。
 *
 * @param article - 表示する記事データ
 * @param isSelected - チェックボックスが選択されているか
 * @param onToggle - チェックボックスの切り替えハンドラ
 */
function ArticleCard({
  article,
  isSelected,
  onToggle,
}: {
  article: ArticleItem;
  isSelected: boolean;
  onToggle: (id: string) => void;
}) {
  const summaryLines = article.summary ? parseSummaryLines(article.summary) : [];

  return (
    <article
      className={`group relative flex flex-col rounded-xl border bg-gray-900/60 p-6 backdrop-blur-sm transition-all duration-200 hover:bg-gray-900/80 hover:shadow-lg hover:shadow-blue-500/5 ${
        isSelected
          ? 'border-blue-500/60 bg-blue-950/20'
          : 'border-gray-800 hover:border-blue-500/40'
      }`}
    >
      {/* ── チェックボックス ──────────────────────── */}
      <div className="absolute right-3 top-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(article.id)}
          className="h-4 w-4 cursor-pointer rounded border-gray-600 bg-gray-800 accent-blue-500"
          aria-label={`${article.titleJa ?? article.title} を選択`}
        />
      </div>

      {/* ── ソース＆日時 ───────────────────────────── */}
      <div className="mb-3 flex items-center justify-between pr-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400 ring-1 ring-blue-500/20">
          {article.source ?? 'Unknown'}
        </span>
        <time className="text-xs text-gray-600" dateTime={article.publishedAt ?? undefined}>
          {formatDate(article.publishedAt)}
        </time>
      </div>

      {/* ── タイトル ──────────────────────────────── */}
      <h2 className="mb-4 text-base font-bold leading-snug text-gray-100 group-hover:text-white">
        {article.titleJa ?? article.title}
      </h2>

      {/* ── AI 要約 ───────────────────────────────── */}
      {summaryLines.length > 0 && (
        <div className="mb-5 flex-1">
          <div className="border-l-2 border-blue-500/50 pl-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-blue-500/70">
              AI Summary
            </p>
            <ul className="space-y-1.5">
              {summaryLines.map((line, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-gray-400">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500/50" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── 元記事リンク ──────────────────────────── */}
      <div className="mt-auto border-t border-gray-800 pt-4">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-blue-400"
        >
          元記事を読む
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

// --- メインコンポーネント ---

/**
 * 記事一覧コンポーネント。
 * キーワード検索・チェックボックス選択・一括削除機能を持つ。
 *
 * @param articles - 表示する記事リスト（Server Component から受け取る）
 */
export default function ArticleList({ articles }: { articles: ArticleItem[] }) {
  // 選択中の記事IDセット。Set を使う理由: O(1) で存在確認・追加・削除ができるため
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 検索クエリ
  const [query, setQuery] = useState('');

  // 削除中フラグ（連打防止）
  const [isDeleting, setIsDeleting] = useState(false);

  // C# の INavigationService に相当
  const router = useRouter();

  // --- フィルタリング ---

  // useMemo でメモ化する理由:
  // query や articles が変わるたびに全件走査するため、
  // 不要な再計算をスキップしてパフォーマンスを維持する。
  const filtered = useMemo(() => {
    if (!query.trim()) return articles;
    const q = query.toLowerCase();
    return articles.filter(
      (a) =>
        (a.titleJa ?? a.title).toLowerCase().includes(q) ||
        (a.source ?? '').toLowerCase().includes(q)
    );
  }, [articles, query]);

  // --- チェックボックス操作 ---

  /**
   * 1件の選択状態をトグルする。
   * @param id - 対象記事のID
   */
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  /**
   * フィルター済み記事の全選択/全解除をトグルする。
   * 全件選択済みなら解除、そうでなければ全選択する。
   */
  function toggleAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
    }
  }

  // --- 削除処理 ---

  /**
   * 選択中の記事を一括削除する。
   * 削除後に router.refresh() で一覧を再取得する。
   */
  async function handleDelete() {
    if (selected.size === 0 || isDeleting) return;

    setIsDeleting(true);
    try {
      await fetch('/api/articles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      setSelected(new Set()); // 削除後は選択状態をリセット
      router.refresh(); // サーバーコンポーネントを再レンダリングして一覧を更新
    } finally {
      setIsDeleting(false);
    }
  }

  const allChecked = filtered.length > 0 && selected.size === filtered.length;
  const someChecked = selected.size > 0 && !allChecked;

  return (
    <div>
      {/* ── 検索・操作バー ────────────────────────── */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* 検索入力 */}
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="タイトル・ソースで検索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-800/60 py-2 pl-10 pr-4 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500/60 focus:outline-none sm:w-72"
          />
        </div>

        {/* 選択操作 */}
        <div className="flex items-center gap-3">
          {/* 全選択チェックボックス */}
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500 select-none">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => {
                // indeterminate 状態（一部選択）を設定する。
                // HTML の indeterminate は JSX の prop で直接指定できないため ref を使う。
                if (el) el.indeterminate = someChecked;
              }}
              onChange={toggleAll}
              className="h-4 w-4 cursor-pointer rounded border-gray-600 bg-gray-800 accent-blue-500"
            />
            全選択
          </label>

          {/* 削除ボタン（1件以上選択時のみアクティブ） */}
          {selected.size > 0 && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeleting ? (
                <>
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  削除中...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                  {selected.size}件を削除
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── 記事グリッド ──────────────────────────── */}
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-600">
          {query ? `「${query}」に一致する記事がありません` : '記事がありません'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              isSelected={selected.has(article.id)}
              onToggle={toggleOne}
            />
          ))}
        </div>
      )}
    </div>
  );
}
