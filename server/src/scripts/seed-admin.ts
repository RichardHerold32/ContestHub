import { Prisma } from "../generated/prisma/client.js";
import { seedFirstAdmin } from "../services/seed-admin.js";
import { registration } from "../validation/auth.js";

const account = registration.safeParse({
  name: process.env.CONTESTHUB_ADMIN_NAME,
  email: process.env.CONTESTHUB_ADMIN_EMAIL,
  password: process.env.CONTESTHUB_ADMIN_PASSWORD,
});
delete process.env.CONTESTHUB_ADMIN_PASSWORD;

if (!account.success) {
  console.error("Set CONTESTHUB_ADMIN_NAME, CONTESTHUB_ADMIN_EMAIL and a 12–128 character CONTESTHUB_ADMIN_PASSWORD.");
  process.exitCode = 1;
} else {
  try {
    const { prisma } = await import("../lib/prisma.js");
    try {
      const created = await seedFirstAdmin(prisma, account.data);
      console.log(created ? "First admin created." : "An admin already exists.");
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    console.error(duplicate
      ? "That email is already in use. Choose an email for a new admin account."
      : "Could not seed the admin. Check the database connection and migrations.");
    process.exitCode = 1;
  }
}
