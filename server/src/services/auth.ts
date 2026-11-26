import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../lib/http-error.js";

const publicFields = { id: true, name: true, email: true, role: true } as const;
export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicFields }>;
const hashing = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
let dummyHash: Promise<string> | undefined;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string) {
  return argon2.hash(password, hashing);
}

export async function register(name: string, email: string, password: string) {
  const { prisma } = await import("../lib/prisma.js");
  const passwordHash = await hashPassword(password);
  try {
    return await prisma.user.create({ data: { name, email, passwordHash }, select: publicFields });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "An account with that email already exists.");
    }
    throw error;
  }
}

export async function login(email: string, password: string, previousToken?: string) {
  const { prisma } = await import("../lib/prisma.js");
  const account = await prisma.user.findUnique({
    where: { email }, select: { ...publicFields, passwordHash: true },
  });
  // Unknown emails also incur the cost of password verification.
  let hash = account?.passwordHash;
  if (!hash) {
    dummyHash ??= argon2.hash(randomBytes(32), hashing);
    hash = await dummyHash;
  }
  const matches = await argon2.verify(hash, password);
  if (!matches || !account) throw new HttpError(401, "Invalid email or password.");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionLifetime);
  await prisma.$transaction(async (tx) => {
    if (previousToken) await tx.session.deleteMany({ where: { tokenHash: tokenHash(previousToken) } });
    await tx.session.create({ data: { userId: account.id, tokenHash: tokenHash(token), expiresAt } });
  });
  const { id, name, role } = account;
  return { user: { id, name, email: account.email, role }, token, expiresAt };
}

export async function sessionUser(token: string) {
  const { prisma } = await import("../lib/prisma.js");
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token), expiresAt: { gt: new Date() } },
    select: { user: { select: publicFields } },
  });
  return session?.user;
}

export async function logout(token: string) {
  const { prisma } = await import("../lib/prisma.js");
  await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
}
