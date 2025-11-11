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
    const extensions = await prisma.$queryRawUnsafe<{ extname: string; schema: string }[]>(
      "SELECT extname, extnamespace::regnamespace::text AS schema FROM pg_extension WHERE extname = 'vector'"
    );
    console.info(extensions);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Failed to query extensions:', error);
  process.exit(1);
});
