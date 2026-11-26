import type { PrismaClient } from "../generated/prisma/client.js";
import { hashPassword } from "./auth.js";

export async function seedFirstAdmin(prisma: PrismaClient, account: { name: string; email: string; password: string }) {
  const { name, email, password } = account;
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    // Serialize first-admin setup across clients sharing this database.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(1128813890, 2)`;
    const existingAdmin = await tx.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    if (existingAdmin) return false;
    await tx.user.create({ data: { name, email, passwordHash, role: "ADMIN" }, select: { id: true } });
    return true;
  }, { isolationLevel: "ReadCommitted" });
}
