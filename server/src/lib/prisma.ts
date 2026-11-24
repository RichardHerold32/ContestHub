import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_URL in server/.env or in the environment.");
}

const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 });

export const prisma = new PrismaClient({ adapter });
