import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  try {
    const result = await prisma.$queryRawUnsafe<{ search_path: string }[]>('SHOW search_path');
    console.info(result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Failed to inspect search_path:', error);
  process.exit(1);
});
