/**
 * トップページ。
 * 開発環境の動作確認用の初期画面。
 * 今後、ニュース一覧やダッシュボードへ置き換える。
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">AI Portfolio</h1>
      <p className="mt-4 text-gray-500">開発環境が正常に起動しています。</p>
    </main>
  )
}
