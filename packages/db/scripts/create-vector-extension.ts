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
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
    console.info('pgvector extension ready.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Failed to ensure pgvector extension:', error);
  process.exit(1);
});
