# --- ベースイメージ ---
# python:3.11-slim を使用。slim はデバッグツール等を省いた軽量版。
FROM python:3.11-slim

# --- 作業ディレクトリ ---
WORKDIR /app

# --- システム依存パッケージ ---
# psycopg2（PostgreSQL ドライバ）のビルドに必要なライブラリをインストール
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# --- 依存関係のインストール ---
# requirements.txt を先にコピーすることで、
# ソースコード変更時に不要な pip install を再実行しないようにする（Dockerキャッシュ最適化）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- ソースコードのコピー ---
# docker-compose の volumes マウントで上書きされるが、
# 単体ビルド時のためにコピーしておく
COPY . .

# --- ポート公開 ---
EXPOSE 8000

# --- 開発サーバー起動 ---
# --reload フラグでホットリロードを有効化（ソース変更を即座に反映）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
