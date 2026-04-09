// --- Gemini AI 連携モジュール ---
// 役割: Google GenAI SDK を使って Gemini にアクセスし、
//       ニュース記事の日本語タイトルと要約テキストを生成する。
// DB更新は呼び出し元スクリプトが担う（責務分離 / CLAUDE.md §4-1）。

import { GoogleGenAI } from '@google/genai'; // C# の HttpClient 相当のSDKクライアント

// --- 型定義 ---

/**
 * Gemini が生成する構造化出力の型。
 * タイトルと要約を1回のAPIコールで取得することで、
 * API呼び出し回数とコストを削減する。
 */
export interface ArticleSummaryResult {
  /** Gemini が生成した日本語タイトル */
  titleJa: string;
  /** 3行以内の箇条書き要約 */
  summary: string;
}

// --- 定数定義 ---

/**
 * 使用するモデル名。
 * gemini-2.5-flash-lite を使う理由:
 * - gemini-1.5-flash は API から廃止（404）
 * - gemini-2.0-flash-lite は Free Tier クォータが 0（有料プランのみ）
 * - gemini-2.5-flash-lite は 2026年現在の標準無料枠モデルで要約タスクに十分な性能を持つ
 */
const MODEL_NAME = 'gemini-2.5-flash-lite';

/**
 * 要約生成プロンプトのテンプレート。
 *
 * 出力を「1行目=日本語タイトル、2行目以降=箇条書き要約」に統一する理由:
 * JSON出力は Gemini の応答が不安定になることがあるため、
 * シンプルなテキスト形式を採用し、1行目をタイトル、残りを要約として確実に分割できる設計にする。
 *
 * 「3行以内」に制限する理由:
 * SNS投稿・ブログカード等での利用を想定しており、
 * 長すぎる要約は読み飛ばされるため、情報密度を最大化した短文が価値を持つ。
 */
const SUMMARY_PROMPT_TEMPLATE = `
あなたはITエンジニア向けのテックニュースキュレーターです。
以下のニュース記事を処理し、指定フォーマットで出力してください。

## 出力フォーマット（厳守）
1行目: 記事の内容を表す日本語タイトル（30文字以内）
2行目以降: 技術的価値を重視した日本語の箇条書き要約（3行以内）

## 要約ルール
- 使用技術・性能指標・アーキテクチャの変化など技術的な詳細を優先すること
- ビジネス的な背景・企業名の紹介は最小限にとどめること
- 専門用語はそのまま使用してよい（読者はエンジニアのため）
- 各行は "- " で始めること
- 前置き・後書き・見出し・マークダウン記号は不要

## 出力例
Windows 11 強制アップデートの仕組み
- 機械学習で対象PCを自動判別し、旧バージョンから25H2へ強制移行。
- インテリジェントな更新システムにより、サポート終了前の移行を促進。
- 対象はWindows 11の旧バージョン搭載PC。

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
 * ニュース記事のタイトルと本文から、日本語タイトルと要約を生成する。
 *
 * 出力パース方針:
 * 1行目をタイトル、2行目以降を要約として分割する。
 * Gemini が出力フォーマットを守らなかった場合は元の英語タイトルを維持し、
 * 全文を要約として扱うフォールバックを適用する。
 *
 * @param title - 記事の英語タイトル（プロンプトのコンテキストとして使用）
 * @param content - 記事本文（null の場合はタイトルのみで推測）
 * @returns 日本語タイトルと要約を含むオブジェクト
 * @throws {Error} API呼び出し失敗時、またはAPIキー未設定時
 */
export async function summarizeArticle(
  title: string,
  content: string | null
): Promise<ArticleSummaryResult> {
  const ai = getGenAI();

  // content が null の記事も処理できるよう、タイトルで補完する。
  // News API 無料プランは本文を先頭200文字程度しか返さないケースがある。
  const contentText =
    content && content.trim().length > 0
      ? content
      : '（本文なし。タイトルから推測して要約してください）';

  const prompt = SUMMARY_PROMPT_TEMPLATE
    .replace('{TITLE}', title)
    .replace('{CONTENT}', contentText);

  // C# の await Task<string> に相当
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
  });

  const text = response.text?.trim() ?? '';

  if (!text) {
    throw new Error(`[gemini] 空のレスポンスが返されました。title: ${title}`);
  }

  // --- 出力パース ---
  // 1行目をタイトル、2行目以降を要約として分割する。
  // Gemini が "- " で始まるタイトルを返した場合はプレフィックスを除去する。
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const rawTitleJa = lines[0].replace(/^[-・]\s*/, '').trim();
  const summary = lines.slice(1).join('\n').trim();

  // タイトルが生成されなかった、または要約が空の場合はフォールバック。
  // プロンプト指示を無視した応答への安全策。
  if (!rawTitleJa || !summary) {
    return {
      titleJa: rawTitleJa || title, // タイトルがなければ元の英語タイトルを使用
      summary: summary || text,     // 要約がなければ全文を要約として使用
    };
  }

  return { titleJa: rawTitleJa, summary };
}
