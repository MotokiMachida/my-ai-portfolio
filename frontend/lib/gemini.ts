// --- Gemini AI 連携モジュール ---
// 役割: Google AI SDK を使って Gemini 1.5 Flash へアクセスし、
//       ニュース記事の要約テキストを生成する。
// DB更新は呼び出し元スクリプトが担う（責務分離 / CLAUDE.md §4-1）。

import { GoogleGenerativeAI } from '@google/generative-ai'; // C# の HttpClient 相当のSDKクライアント

// --- 定数定義 ---

/**
 * 使用するモデル名。
 * Gemini 1.5 Flash は高速・低コストで、要約タスクに最適なバランスを持つ。
 * Pro より応答が速く、要約程度のタスクでは品質差がほぼない。
 */
const MODEL_NAME = 'gemini-1.5-flash';

/**
 * 要約生成プロンプトのテンプレート。
 *
 * 「ITエンジニア向け」に絞る理由:
 * 本ポートフォリオはエンジニアが閲覧する前提のため、
 * ビジネス的背景より技術的な実装内容・影響・活用方法を優先した要約が価値を持つ。
 *
 * 箇条書き形式にする理由:
 * 投稿先（SNS・ブログ等）での視認性向上と、文字数制限対応のため。
 */
const SUMMARY_PROMPT_TEMPLATE = `
あなたはITエンジニア向けのテックニュースキュレーターです。
以下のニュース記事を、ITエンジニアが技術的価値を素早く判断できるよう日本語で要約してください。

## 要約ルール
- 3〜5行の箇条書き形式で出力すること
- 技術的な詳細（使用技術・アーキテクチャ・性能指標など）を優先して含めること
- ビジネス的な背景は最小限にとどめること
- 専門用語はそのまま使用してよい（読者はエンジニアのため）
- 出力は要約本文のみ（前置き・後書き・マークダウン記号は不要）

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
 * @returns 初期化済みの GenerativeModel インスタンス
 * @throws {Error} GEMINI_API_KEY が未設定の場合
 */
function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error(
      '[gemini] GEMINI_API_KEY が未設定です。\n' +
        '.env ファイルに GEMINI_API_KEY=your_actual_key を設定してください。\n' +
        'APIキーは https://aistudio.google.com/app/apikey から取得できます。'
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: MODEL_NAME });
}

// --- 要約関数 ---

/**
 * ニュース記事のタイトルと本文を受け取り、Gemini 1.5 Flash で要約を生成する。
 *
 * @param title - 記事タイトル
 * @param content - 記事本文（null の場合はタイトルのみで要約を試みる）
 * @returns 生成された要約テキスト（箇条書き形式）
 * @throws {Error} API呼び出し失敗時、またはAPIキー未設定時
 */
export async function summarizeArticle(
  title: string,
  content: string | null
): Promise<string> {
  const model = getGeminiModel();

  // content が null の記事も処理できるよう、タイトルで補完する。
  // News API は本文を返さないケースがあるため（CLAUDE.md §schema.prisma参照）。
  const contentText =
    content && content.trim().length > 0
      ? content
      : `（本文なし。タイトルから推測して要約してください）`;

  const prompt = SUMMARY_PROMPT_TEMPLATE.replace('{TITLE}', title).replace(
    '{CONTENT}',
    contentText
  );

  const result = await model.generateContent(prompt); // C# の await Task<GenerateContentResponse> に相当
  const response = result.response;
  const text = response.text();

  if (!text || text.trim().length === 0) {
    throw new Error(`[gemini] 空のレスポンスが返されました。title: ${title}`);
  }

  return text.trim();
}
