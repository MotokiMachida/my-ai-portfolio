# --- ベースイメージ ---
# node:20-alpine を使用。Alpine は軽量で本番環境にも適している。
FROM node:20-alpine

# --- 作業ディレクトリ ---
WORKDIR /app

# --- システム依存パッケージ ---
# libc6-compat: Next.js のビルドに必要な Alpine の musl libc 互換レイヤー
# openssl: Prisma の schema engine が OpenSSL を必要とするため追加
RUN apk add --no-cache libc6-compat openssl

# --- 依存関係のインストール ---
# package.json と package-lock.json を先にコピーすることで、
# ソースコード変更時に不要な npm install を再実行しないようにする（Dockerキャッシュ最適化）
COPY package*.json ./
RUN npm install

# --- ソースコードのコピー ---
# docker-compose の volumes マウントで上書きされるが、
# 単体ビルド時のためにコピーしておく
COPY . .

# --- ポート公開 ---
EXPOSE 3000

# --- 開発サーバー起動 ---
# docker-compose 側の command で上書きされる。
# ここではデフォルトとして定義。
CMD ["npm", "run", "dev"]
