// --- News API 連携モジュール ---
// ワークフロー: このモジュールが「取得」を担い、DB保存は呼び出し元が行う（責務分離）。
// DBファースト設計 (CLAUDE.md §4-1) に基づき、取得データの構造のみを定義し、
// 永続化ロジックは含まない。

// --- 型定義 ---

/**
 * News API のレスポンス内の1記事を表す型
 * @see https://newsapi.org/docs/endpoints/top-headlines
 */
interface NewsApiArticle {
  title: string;
  url: string;
  /** 記事本文。News APIは先頭200文字程度しか返さない場合がある */
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

// --- ダミーデータ ---
// NEWS_API_KEY が未設定の場合でもテスト・開発が進められるよう、
// 本番に近い構造のダミー記事を用意する。
// 実際の API レスポンス構造に合わせてあるため、切り替えコストがほぼゼロ。
const DUMMY_ARTICLES: ArticleInput[] = [
  {
    title: '【速報】日本のAI開発予算が過去最高を更新、政府が1兆円規模の投資を発表',
    url: 'https://example.com/news/ai-budget-japan-2026',
    content:
      '政府は本日、AI研究開発に対する国家予算として過去最大規模となる1兆円の投資計画を発表した。この予算は今後5年間にわたり、大学・研究機関・スタートアップへ分配される予定だ。',
    source: 'Tech News Japan',
    imageUrl: 'https://picsum.photos/seed/ai-budget/800/400',
    publishedAt: new Date('2026-04-08T09:00:00+09:00'),
  },
  {
    title: 'OpenAI、新モデル「GPT-5」を正式リリース──推論能力が大幅向上',
    url: 'https://example.com/news/openai-gpt5-release',
    content:
      'OpenAIは最新言語モデル「GPT-5」の一般提供を開始した。ベンチマークテストでは前モデル比で推論精度が40%向上しており、複雑な数学問題や法律文書の解析で特に顕著な改善が見られる。',
    source: 'AI Times',
    imageUrl: 'https://picsum.photos/seed/gpt5/800/400',
    publishedAt: new Date('2026-04-08T08:30:00+09:00'),
  },
  {
    title: 'Googleが量子コンピュータで新記録を達成、従来比1000倍の処理速度',
    url: 'https://example.com/news/google-quantum-record',
    content:
      'Googleの研究チームは量子コンピュータ「Willow」の後継機で、従来比1000倍の処理速度を達成したと発表した。この進歩により、創薬や材料科学の分野での実用化が一気に現実味を帯びてきた。',
    source: 'Science Tech Daily',
    imageUrl: 'https://picsum.photos/seed/quantum/800/400',
    publishedAt: new Date('2026-04-07T18:00:00+09:00'),
  },
  {
    title: 'トヨタ、完全自動運転タクシーの商用運行を東京23区で開始',
    url: 'https://example.com/news/toyota-autonomous-taxi-tokyo',
    content:
      'トヨタ自動車は本日から東京23区全域で完全自動運転タクシーの商用サービスを開始した。安全確保のため当面は同乗オペレーターを配置するが、2027年までに完全無人運行を目指す。',
    source: 'Automotive Japan',
    imageUrl: 'https://picsum.photos/seed/toyota/800/400',
    publishedAt: new Date('2026-04-07T10:00:00+09:00'),
  },
  {
    title: 'Meta、AR眼鏡「Orion 2」を発表──重量80gで終日装着が可能に',
    url: 'https://example.com/news/meta-orion2-announcement',
    content:
      'Metaは次世代AR眼鏡「Orion 2」を正式発表した。重量を初代比50%削減し80gを実現、バッテリー持続時間は12時間に延長された。2026年末に日本を含むグローバル市場で発売予定。',
    source: 'Gadget Watch',
    imageUrl: 'https://picsum.photos/seed/meta-ar/800/400',
    publishedAt: new Date('2026-04-06T20:00:00+09:00'),
  },
];

// --- API 呼び出し ---

/**
 * News API からトップヘッドライン記事を取得する。
 *
 * 環境変数 NEWS_API_KEY が未設定の場合はダミーデータを返す。
 * これにより、APIキー取得前でも開発・テストのフローを止めずに進められる。
 *
 * @param country - 取得対象の国コード（デフォルト: 'jp'）
 * @param pageSize - 取得件数（デフォルト: 10、最大: 100）
 * @returns 正規化済みの記事リスト
 * @throws {Error} News API がエラーステータスを返した場合
 */
export async function fetchTopHeadlines(
  country: string = 'jp',
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

  const url =
    `https://newsapi.org/v2/top-headlines` +
    `?country=${country}&pageSize=${pageSize}&apiKey=${apiKey}`;

  const response = await fetch(url); // C# の await HttpClient.GetAsync に相当

  if (!response.ok) {
    throw new Error(
      `News API リクエスト失敗: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data: NewsApiResponse = await response.json(); // C# の await response.Content.ReadAsAsync<T> に相当

  if (data.status !== 'ok') {
    throw new Error(`News API エラーレスポンス: status=${data.status}`);
  }

  // News API のレスポンス構造を DB 保存用の型に正規化する。
  // urlToImage → imageUrl のようにフィールド名を統一し、
  // 呼び出し元が API の詳細を知らなくても済む構造にする。
  return data.articles.map(
    (article): ArticleInput => ({
      title: article.title,
      url: article.url,
      // content と description が両方存在する場合は content を優先する。
      // content のほうが本文に近い情報を持つが、null の場合は description で補完する。
      content: article.content ?? article.description ?? null,
      source: article.source.name ?? null,
      imageUrl: article.urlToImage ?? null,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
    })
  );
}
