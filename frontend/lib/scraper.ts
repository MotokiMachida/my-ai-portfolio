// --- 記事スクレイピングモジュール ---
// 役割: 記事URLにアクセスして本文テキストを抽出する。
// News API 無料プランは本文を先頭200文字しか返さないため、
// 要約の品質を高めるには元ページから全文を取得する必要がある。
//
// 依存ライブラリを追加しない理由:
// cheerio 等を使えばより正確に取得できるが、
// ニュース要約用途では「本文らしいブロックを大まかに取れれば十分」であり、
// 依存を増やすコストに見合わない。Node 18+ の built-in fetch で完結させる。

// --- 定数 ---

/**
 * スクレイピングタイムアウト（ms）。
 * 遅いサイトや無応答サイトでパイプライン全体が止まらないよう上限を設ける。
 */
const SCRAPE_TIMEOUT_MS = 10_000;

/**
 * Gemini に渡す本文の最大文字数。
 * 長すぎるとトークン上限に引っかかるため、品質と効率のバランスで 6000 文字に設定。
 */
const MAX_CONTENT_LENGTH = 6_000;

/**
 * スクレイピング時に送る User-Agent。
 * Node.js のデフォルト UA はブロックされるサイトが多いため、
 * 一般的なブラウザに偽装することでアクセス拒否を回避する。
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// --- HTML 本文抽出 ---

/**
 * HTML 文字列から本文テキストを抽出する。
 *
 * 抽出ロジックの優先順:
 * 1. <article> タグ（セマンティックに本文を示す最も信頼性の高いタグ）
 * 2. <main> タグ（ページのメインコンテンツを示す）
 * 3. class/id に "content", "article", "body", "text" を含む <div>（慣習的な命名規則）
 * 4. 全 <p> タグの集合（上記すべてで取得できない場合のフォールバック）
 *
 * @param html - 元の HTML 文字列
 * @returns 抽出したプレーンテキスト（MAX_CONTENT_LENGTH 文字で切り捨て）
 */
function extractTextFromHtml(html: string): string {
  // スクリプト・スタイル・SVG・コメントを先に除去する。
  // これらを残すと後工程のテキスト抽出ノイズになる。
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')       // ナビゲーションは本文外
    .replace(/<header[\s\S]*?<\/header>/gi, '') // ヘッダーは本文外
    .replace(/<footer[\s\S]*?<\/footer>/gi, '') // フッターは本文外
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');  // サイドバーは本文外

  // --- 優先度1: <article> タグ ---
  const articleMatch = cleaned.match(/<article[\s\S]*?<\/article>/i);
  if (articleMatch) {
    return stripTagsAndNormalize(articleMatch[0]).slice(0, MAX_CONTENT_LENGTH);
  }

  // --- 優先度2: <main> タグ ---
  const mainMatch = cleaned.match(/<main[\s\S]*?<\/main>/i);
  if (mainMatch) {
    return stripTagsAndNormalize(mainMatch[0]).slice(0, MAX_CONTENT_LENGTH);
  }

  // --- 優先度3: 本文らしいクラス名を持つ div ---
  // class や id に "content", "article", "body", "entry", "text" を含む div を探す。
  // ニュースサイトの多数がこのパターンを採用している。
  const contentDivMatch = cleaned.match(
    /<div[^>]+(?:class|id)="[^"]*(?:content|article|body|entry|text|post)[^"]*"[\s\S]*?<\/div>/i
  );
  if (contentDivMatch) {
    const text = stripTagsAndNormalize(contentDivMatch[0]);
    if (text.length > 200) { // 短すぎる場合はフォールバックへ
      return text.slice(0, MAX_CONTENT_LENGTH);
    }
  }

  // --- 優先度4: 全 <p> タグの集合（フォールバック） ---
  // 上記すべてで十分な本文が取れなかった場合、
  // ページ内の段落テキストをすべて結合する。
  const paragraphs = cleaned.match(/<p[\s\S]*?<\/p>/gi) ?? [];
  const paragraphText = paragraphs
    .map((p) => stripTagsAndNormalize(p))
    .filter((t) => t.length > 30) // 極端に短い段落（広告ラベル等）を除外
    .join('\n');

  return paragraphText.slice(0, MAX_CONTENT_LENGTH);
}

/**
 * HTML タグを除去し、連続する空白・改行を正規化する。
 *
 * @param html - タグを除去する HTML 断片
 * @returns プレーンテキスト
 */
function stripTagsAndNormalize(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')       // HTML タグをスペースに置換
    .replace(/&nbsp;/g, ' ')        // HTML エンティティを変換
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')        // 連続スペースを1つに
    .replace(/\n{3,}/g, '\n\n')     // 3行以上の空行を2行に
    .trim();
}

// --- メイン関数 ---

/**
 * 指定した URL にアクセスして記事本文テキストを取得する。
 *
 * タイムアウト・ネットワークエラー・パースエラーのいずれでも null を返す。
 * 呼び出し元は null の場合に News API の部分テキストへフォールバックすること。
 *
 * @param url - スクレイピング対象の記事 URL
 * @returns 抽出した本文テキスト、または取得失敗時は null
 */
export async function scrapeArticleContent(url: string): Promise<string | null> {
  const controller = new AbortController(); // C# の CancellationToken に相当
  const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        // キャッシュを優先して余分なネットワーク通信を減らす
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });

    if (!response.ok) {
      console.warn(`  [scraper] HTTP ${response.status}: ${url}`);
      return null;
    }

    // Content-Type が HTML でない場合（PDF 等）はスキップする
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      console.warn(`  [scraper] HTML 以外のコンテンツ (${contentType}): ${url}`);
      return null;
    }

    const html = await response.text();
    const text = extractTextFromHtml(html);

    if (text.length < 100) {
      // 抽出テキストが短すぎる場合はスクレイピング失敗とみなす。
      // JavaScript レンダリング必須のSPA等でよく起きる。
      console.warn(`  [scraper] テキスト抽出量不足 (${text.length}文字): ${url}`);
      return null;
    }

    return text;
  } catch (err) {
    // abort（タイムアウト）やネットワークエラーは握りつぶしてフォールバックさせる。
    // スクレイピング失敗でパイプライン全体を止めないための設計。
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  [scraper] 取得失敗 (${message}): ${url}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
