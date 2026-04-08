"""
FastAPI エントリーポイント。

このファイルはアプリケーションのルートとなる。
ルーターは機能単位で services/ 配下に分割し、ここで include_router する設計。
"""

from fastapi import FastAPI

# --- アプリケーション初期化 ---
app = FastAPI(
    title="AI Portfolio API",
    description="ニュース取得・AI要約・投稿管理を行うバックエンドAPI",
    version="0.1.0",
)


# --- ヘルスチェック ---
@app.get("/health")
async def health_check() -> dict[str, str]:
    """
    サービスの死活監視用エンドポイント。

    Returns:
        dict: ステータスを示すJSONレスポンス
    """
    return {"status": "ok"}
