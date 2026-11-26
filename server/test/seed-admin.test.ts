import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect, it } from "vitest";
import { app } from "../src/app.js";
import { seedFirstAdmin } from "../src/services/seed-admin.js";
import { registration } from "../src/validation/auth.js";
import { useTestDatabase } from "./database.js";

const db = useTestDatabase();
const api = request(app);
const origin = new URL(process.env.CLIENT_URL ?? "http://127.0.0.1:5173").origin;

function seed(email: string, password: string) {
  return seedFirstAdmin(db(), registration.parse({ name: "First admin", email, password }));
}

it("keeps a colliding public account as USER and creates only one admin across concurrent runs", async () => {
  const password = randomUUID();
  const collision = { name: "Public account", email: "collision@example.invalid", password };
  await api.post("/api/auth/register").set("Origin", origin).send(collision).expect(201);
  await expect(seed(collision.email.toUpperCase(), password)).rejects.toMatchObject({ code: "P2002" });
  expect(await db().user.findUnique({ where: { email: collision.email } })).toMatchObject({ role: "USER" });

  const candidates = ["first@example.invalid", "other@example.invalid"];
  const runs = await Promise.all(candidates.map((email) => seed(email, password)));
  expect(runs.sort()).toEqual([false, true]);
  const admins = await db().user.findMany({ where: { role: "ADMIN" } });
  expect(admins).toHaveLength(1);
  const [admin] = admins;
  expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
  const { body } = await api.post("/api/auth/login").set("Origin", origin).send({ email: admin.email, password }).expect(200);
  expect(body.user.role).toBe("ADMIN");
  expect(await seed(admin.email, randomUUID())).toBe(false);
  expect(await db().user.findUnique({ where: { id: admin.id } })).toEqual(admin);
}, 20_000);
