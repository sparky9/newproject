import { PrismaClient } from '@prisma/client';

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'ocsuite_unit_test';

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  try {
    await prisma.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
    console.info(`Created database ${TEST_DB_NAME}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  if ((error as Error).message?.includes('already exists')) {
    console.info(`Database ${TEST_DB_NAME} already exists.`);
    process.exit(0);
  }

  console.error('Failed to create test database:', error);
  process.exit(1);
});
