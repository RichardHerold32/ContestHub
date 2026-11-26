import { SyncError, syncCodeforces } from "../services/codeforces.js";

try {
  const { prisma } = await import("../lib/prisma.js");
  try {
    const { added, updated, skipped } = await syncCodeforces(prisma);
    console.log(`Codeforces sync complete. added=${added} updated=${updated} skipped=${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
} catch (error) {
  const message = error instanceof SyncError ? error.message : "Check the PostgreSQL connection and migrations.";
  console.error(`Codeforces sync failed. ${message}`);
  process.exitCode = 1;
}
