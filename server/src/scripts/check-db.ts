import { prisma } from "../lib/prisma.js";

try {
  await prisma.$queryRaw`SELECT 1`.finally(() => prisma.$disconnect());
  console.log("PostgreSQL connection OK.");
} catch {
  console.error("PostgreSQL check failed. Check DATABASE_URL and confirm PostgreSQL is running.");
  process.exitCode = 1;
}
