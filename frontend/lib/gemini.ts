// --- Gemini AI 連携モジュール ---
// 役割: Google GenAI SDK を使って Gemini にアクセスし、
//       ニュース記事の要約テキストを生成する。
// DB更新は呼び出し元スクリプトが担う（責務分離 / CLAUDE.md §4-1）。

import { GoogleGenAI } from '@google/genai'; // C# の HttpClient 相当のSDKクライアント

// --- 定数定義 ---

/**
 * 使用するモデル名。
 * gemini-2.0-flash-lite を使う理由:
 * - gemini-1.5-flash は 2025年末頃に v1/v1beta API から廃止された
 * - gemini-2.0-flash は無料枠のクォータが 0（有料プランのみ）
 * - gemini-2.0-flash-lite は Gemini 2.0 世代の最軽量モデルで無料枠が存在する
 */
const MODEL_NAME = 'gemini-2.0-flash-lite';

/**
 * 要約生成プロンプトのテンプレート。
 *
 * 「3行以内」に制限する理由:
 * SNS投稿・ブログカード等での利用を想定しており、
 * 長すぎる要約は読み飛ばされるため、情報密度を最大化した短文が価値を持つ。
 *
 * 「ITエンジニア向け・技術的価値を重視」にする理由:
 * 本ポートフォリオはエンジニアが閲覧する前提のため、
 * ビジネス的背景より技術的な実装内容・影響・活用方法を優先した要約が求められる。
 */
const SUMMARY_PROMPT_TEMPLATE = `
あなたはITエンジニア向けのテックニュースキュレーターです。
以下のニュース記事を、ITエンジニアが技術的価値を素早く判断できるよう日本語で要約してください。

## 要約ルール
- 3行以内の箇条書きで出力すること（必ず3行以内に収めること）
- 使用技術・性能指標・アーキテクチャの変化など技術的な詳細を優先して含めること
- ビジネス的な背景・企業名の紹介は最小限にとどめること
- 専門用語はそのまま使用してよい（読者はエンジニアのため）
- 出力は箇条書きの本文のみ（前置き・後書き・見出し・マークダウン記号は不要）

## 記事タイトル
{TITLE}

## 記事本文
{CONTENT}
`.trim();

// --- クライアント初期化 ---

/**
 * Gemini API クライアントを生成して返す。
 *
 * 関数内で初期化する理由:
 * モジュールロード時に GEMINI_API_KEY を参照すると、
 * スクリプト起動直後（dotenv読み込み前）に undefined になるケースがあるため、
 * 実際に使う直前に環境変数を読み取る遅延初期化パターンを採用する。
 *
 * @returns 初期化済みの GoogleGenAI インスタンス
 * @throws {Error} GEMINI_API_KEY が未設定の場合
 */
function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error(
      '[gemini] GEMINI_API_KEY が未設定です。\n' +
        '.env ファイルに GEMINI_API_KEY=your_actual_key を設定してください。\n' +
        'APIキーは https://aistudio.google.com/app/apikey から取得できます。'
    );
  }

  return new GoogleGenAI({ apiKey }); // C# の new HttpClient() に相当
}

// --- 要約関数 ---

/**
 * ニュース記事のタイトルと本文を受け取り、Gemini で要約を生成する。
 *
 * @param title - 記事タイトル
 * @param content - 記事本文（null の場合はタイトルのみで要約を試みる）
 * @returns 生成された要約テキスト（3行以内の箇条書き形式）
 * @throws {Error} API呼び出し失敗時、またはAPIキー未設定時
 */
export async function summarizeArticle(
  title: string,
  content: string | null
): Promise<string> {
  const ai = getGenAI();

  // content が null の記事も処理できるよう、タイトルで補完する。
  // News API 無料プランは本文を先頭200文字程度しか返さないケースがある。
  const contentText =
    content && content.trim().length > 0
      ? content
      : '（本文なし。タイトルから推測して要約してください）';

  const prompt = SUMMARY_PROMPT_TEMPLATE.replace('{TITLE}', title).replace(
    '{CONTENT}',
    contentText
  );

  // C# の await Task<string> に相当
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
  });

  const text = response.text;

  if (!text || text.trim().length === 0) {
    throw new Error(`[gemini] 空のレスポンスが返されました。title: ${title}`);
  }

  return text.trim();
}
