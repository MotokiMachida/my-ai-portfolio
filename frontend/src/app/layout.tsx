import type { Metadata } from 'next'
import './globals.css'

/** アプリケーション全体のメタデータ定義 */
export const metadata: Metadata = {
  title: 'AI Portfolio',
  description: 'ニュース取得・AI要約・投稿管理システム',
}

/**
 * ルートレイアウト。
 * すべてのページを包むルートコンポーネント。
 * @param children - 各ページのコンテンツ
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
