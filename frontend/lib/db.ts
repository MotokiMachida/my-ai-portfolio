// --- Prisma クライアント シングルトン ---
// Next.js の開発モードではホットリロードのたびにモジュールが再評価される。
// そのまま new PrismaClient() すると接続が際限なく増えて
// "Too many connections" エラーになるため、globalThis にキャッシュする。
// 本番(production)では各プロセスで1インスタンスのみ生成されるため問題ない。
// 参考: https://www.prisma.io/docs/guides/other/troubleshooting-orm/help-articles/nextjs-prisma-client-dev-practices

import { PrismaClient } from '@prisma/client';

// C# の static フィールドによるシングルトンに相当するパターン
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * アプリケーション全体で共有する Prisma クライアントインスタンス。
 * 開発環境では globalThis にキャッシュし、ホットリロードによる多重生成を防ぐ。
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
