// --- News API 連携モジュール ---
// ワークフロー: このモジュールが「取得」を担い、DB保存は呼び出し元が行う（責務分離）。
// DBファースト設計 (CLAUDE.md §4-1) に基づき、取得データの構造のみを定義し、
// 永続化ロジックは含まない。

// --- 型定義 ---

/**
 * News API のレスポンス内の1記事を表す型
 * @see https://newsapi.org/docs/endpoints/everything
 */
interface NewsApiArticle {
  title: string;
  url: string;
  /** 記事本文。News API 無料プランは先頭200文字程度しか返さない */
  content: string | null;
  description: string | null;
  publishedAt: string | null;
  source: {
    name: string | null;
  };
  urlToImage: string | null;
}

/**
 * News API のトップレベルレスポンス型
 */
interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

/**
 * DB保存用に正規化した記事入力型。
 * Prisma の Article モデルの create 入力に対応する。
 */
export interface ArticleInput {
  title: string;
  url: string;
  content: string | null;
  source: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
}

// --- 定数定義 ---

/**
 * ITエンジニア向け検索キーワード。
 *
 * OR でつなぐことで複数トピックを一度のリクエストでカバーする。
 * top-headlines ではなく everything エンドポイントを使う理由:
 * top-headlines はカテゴリ・国単位の取得のみで、技術キーワードでの絞り込みができない。
 * everything はキーワード検索に対応しており、エンジニア向け記事に特化できる。
 *
 * キーワード選定方針:
 * - プログラミング言語・フレームワークに限定し、ビジネス記事が混入しにくい具体的な技術名を使う
 * - "AI" 単体は範囲が広すぎるため "LLM" / "generative AI" など技術文脈に限定する
 * - "-sports -entertainment" のような除外指定は News API 無料プランで機能しないため使わない
 */
const TECH_QUERY =
  'TypeScript OR JavaScript OR "Next.js" OR "Node.js" OR React OR Python OR Rust OR Go OR ' +
  'Kubernetes OR Docker OR "open source" OR LLM OR "large language model" OR ' +
  '"generative AI" OR "vector database" OR "GitHub Copilot" OR "code review" OR DevOps';

// --- ダミーデータ ---
// NEWS_API_KEY が未設定の場合でもテスト・開発が進められるよう用意する。
// 実際の API レスポンス構造に合わせてあるため、本番切り替えコストがほぼゼロ。
const DUMMY_ARTICLES: ArticleInput[] = [
  {
    title: 'TypeScript 5.5 リリース──型推論の大幅強化と新しいユーティリティ型',
    url: 'https://example.com/news/typescript-5-5-release',
    content:
      'TypeScript 5.5 がリリースされ、条件型の推論精度が向上した。新たに追加された NoInfer<T> ユーティリティ型により、型推論の意図しない伝播を防げるようになった。',
    source: 'TypeScript Blog',
    imageUrl: 'https://picsum.photos/seed/typescript/800/400',
    publishedAt: new Date('2026-04-08T09:00:00+09:00'),
  },
  {
    title: 'React 20 のアーキテクチャ変更──Server Components がデフォルトに',
    url: 'https://example.com/news/react-20-server-components',
    content:
      'React 20 では Server Components がデフォルト挙動となり、クライアント側のバンドルサイズが平均 40% 削減されることが発表された。',
    source: 'React Blog',
    imageUrl: 'https://picsum.photos/seed/react/800/400',
    publishedAt: new Date('2026-04-08T08:00:00+09:00'),
  },
  {
    title: 'Python 3.14 beta──JIT コンパイラが本格統合、実行速度が 2 倍に',
    url: 'https://example.com/news/python-314-jit',
    content:
      'Python 3.14 ベータ版で JIT コンパイラが標準搭載された。数値計算ベンチマークでは CPython 3.12 比で約 2 倍の速度向上が確認されている。',
    source: 'Python.org',
    imageUrl: 'https://picsum.photos/seed/python/800/400',
    publishedAt: new Date('2026-04-07T18:00:00+09:00'),
  },
];

// --- API 呼び出し ---

/**
 * News API の /v2/everything エンドポイントからテックニュースを取得する。
 *
 * 環境変数 NEWS_API_KEY が未設定の場合はダミーデータを返す。
 * これにより、APIキー取得前でも開発・テストのフローを止めずに進められる。
 *
 * @param pageSize - 取得件数（デフォルト: 10、最大: 100）
 * @returns 正規化済みの記事リスト
 * @throws {Error} News API がエラーステータスを返した場合
 */
export async function fetchTechNews(
  pageSize: number = 10
): Promise<ArticleInput[]> {
  const apiKey = process.env.NEWS_API_KEY;

  // APIキーが未設定の場合はダミーデータで代替する。
  // 本番環境では必ず .env に NEWS_API_KEY を設定すること。
  if (!apiKey || apiKey === 'your_news_api_key_here') {
    console.log(
      '[newsApi] NEWS_API_KEY が未設定のため、ダミーデータを使用します。'
    );
    return DUMMY_ARTICLES;
  }

  // sortBy=publishedAt: 最新記事を優先して取得する。
  // language=en: 技術記事は英語が多く、日本語記事は少ないため英語に絞る。
  const url =
    `https://newsapi.org/v2/everything` +
    `?q=${encodeURIComponent(TECH_QUERY)}` +
    `&language=en` +
    `&sortBy=publishedAt` +
    `&pageSize=${pageSize}` +
    `&apiKey=${apiKey}`;

  const response = await fetch(url); // C# の await HttpClient.GetAsync に相当

  if (!response.ok) {
    throw new Error(
      `News API リクエスト失敗: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data: NewsApiResponse = await response.json(); // C# の await response.Content.ReadAsAsync<T> に相当

  if (data.status !== 'ok') {
    throw new Error(
      `News API エラーレスポンス: status=${data.status}, message=${JSON.stringify(data)}`
    );
  }

  // News API のレスポンス構造を DB 保存用の型に正規化する。
  // urlToImage → imageUrl のようにフィールド名を統一し、
  // 呼び出し元が API の詳細を知らなくても済む構造にする。
  // title が "[Removed]" の記事は削除済みコンテンツのため除外する。
  return data.articles
    .filter((a) => a.title !== '[Removed]' && a.url !== 'https://removed.com')
    .map(
      (article): ArticleInput => ({
        title: article.title,
        // News API が返す URL に HTML エンティティ（&amp; 等）が混入するケースがある。
        // そのままスクレイピングに使うと 404 になるため、デコードして正規の URL に戻す。
        url: article.url.replace(/&amp;/g, '&'),
        // content と description が両方存在する場合は content を優先する。
        // content のほうが本文に近い情報を持つが、null の場合は description で補完する。
        content: article.content ?? article.description ?? null,
        source: article.source.name ?? null,
        imageUrl: article.urlToImage ?? null,
        publishedAt: article.publishedAt
          ? new Date(article.publishedAt)
          : null,
      })
    );
}
