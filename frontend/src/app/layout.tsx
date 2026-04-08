import type { Metadata } from 'next'
import './globals.css'

/** アプリケーション全体のメタデータ定義 */
export const metadata: Metadata = {
  title: 'AI Tech News | エンジニア向けニュース要約',
  description: 'Gemini AIがITエンジニア向けに技術的価値を重視して要約したニュースキュレーション',
}

/**
 * ルートレイアウト。
 * すべてのページを包むルートコンポーネント。
 * ダークモード基調のデザインをここで確立する。
 * @param children - 各ページのコンテンツ
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // ダークモードを全体に適用するため html 要素に dark クラスを付与する。
    // bg-[#080810]: 純黒より青みがかった超暗色。エンジニア向けUIに多用される配色。
    <html lang="ja" className="dark">
      <body className="bg-[#080810] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  )
}
