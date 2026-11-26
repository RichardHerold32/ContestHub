import { createHash, randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app, handleError } from "../src/app.js";
import { cookieOptions, requireAdmin, requireSession } from "../src/middleware/auth.js";
import { useTestDatabase } from "./database.js";

const db = useTestDatabase();
const api = request(app);
const origin = new URL(process.env.CLIENT_URL ?? "http://127.0.0.1:5173").origin;
const auth = "/api/auth";
const post = (route: string) => api.post(auth + route).set("Origin", origin);
const account = () => ({ name: " Reader ", email: randomUUID() + "@example.invalid", password: randomUUID() + " " });

async function signedIn() {
  const details = account();
  const signup = await post("/register").send(details).expect(201);
  const login = await post("/login").send({ email: details.email, password: details.password }).expect(200);
  const header = login.get("Set-Cookie")![0];
  return { details, user: signup.body.user, cookie: header.split(";")[0], header };
}

describe("authentication", () => {
  it("normalizes accounts, hashes passwords and rejects concurrent duplicates", async () => {
    const details = account();
    const results = await Promise.all([
      post("/register").send(details),
      post("/register").send({ ...details, email: " " + details.email.toUpperCase() + " " }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const user = await db().user.findUniqueOrThrow({ where: { email: details.email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const created = results.find((r) => r.status === 201)!;
    expect(created.get("Set-Cookie")).toBeUndefined();
    expect(created.body).toEqual({ user: { id: user.id, email: details.email, name: "Reader", role: "USER" } });
    await post("/register").send({ ...account(), role: "ADMIN" }).expect(400);
    await post("/register").send({ ...account(), password: "short" }).expect(400);
  });

  it("issues a host-only session, stores its digest, and rotates it on login", async () => {
    const { details, user, header, cookie } = await signedIn();
    expect(header).toMatch(/; HttpOnly/i);
    expect(header).toMatch(/; SameSite=Lax/i);
    expect(header).toContain("Path=/api");
    expect(header).not.toMatch(/; Domain=/i);
    const token = cookie.split("=")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const session = await db().session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(session.expiresAt.getTime() - Date.now()).toBeCloseTo(7 * 86400_000, -4);
    expect(Date.parse(header.match(/Expires=([^;]+)/i)![1])).toBe(Math.floor(+session.expiresAt / 1000) * 1000);
    await api.get(auth + "/me").set("Cookie", cookie).expect("Cache-Control", "no-store").expect(200, { user });
    const replacement = await post("/login").set("Cookie", cookie)
      .send({ email: details.email.toUpperCase(), password: details.password }).expect(200, { user });
    const newCookie = replacement.get("Set-Cookie")![0].split(";")[0];
    expect(newCookie).not.toBe(cookie);
    await api.get(auth + "/me").set("Cookie", cookie).expect(401);
    await api.get(auth + "/me").set("Cookie", newCookie).expect(200, { user });
  });

  it("uses the same error for wrong passwords and unknown accounts", async () => {
    const details = account();
    await post("/register").send(details).expect(201);
    for (const email of [details.email, account().email]) {
      await post("/login").send({ email, password: details.password.trim() })
        .expect(401, { error: { message: "Invalid email or password." } });
    }
  });

  it("rejects expired, missing and malformed credentials", async () => {
    const { user, cookie } = await signedIn();
    await db().session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
    await api.get(auth + "/me").set("Cookie", cookie).expect(401);
    await api.get(auth + "/me").set("Cookie", "contesthub_session=bad").expect(401);
    await api.get(auth + "/me").expect(401);
  });

  it("revokes only the submitted session and clears its cookie on repeated logout", async () => {
    const { details, cookie } = await signedIn();
    const other = await post("/login").send({ email: details.email, password: details.password }).expect(200);
    const cleared = await post("/logout").set("Cookie", cookie).expect(204);
    expect(cleared.get("Set-Cookie")![0]).toMatch(/^contesthub_session=; Path=\/api; Expires=Thu, 01 Jan 1970/i);
    await api.get(auth + "/me").set("Cookie", cookie).expect(401);
    await post("/logout").set("Cookie", cookie).expect(204);
    await api.get(auth + "/me").set("Cookie", other.get("Set-Cookie")![0].split(";")[0]).expect(200);
  });

  it("checks the current database role on a direct admin request", async () => {
    const admin = express();
    admin.use(cookieParser());
    admin.get("/api/admin/probe", requireSession, requireAdmin, (_req, res) => res.sendStatus(204));
    admin.use(handleError);
    const { user, cookie } = await signedIn();
    await request(admin).get("/api/admin/probe").expect(401);
    await request(admin).get("/api/admin/probe").set("Cookie", cookie).expect(403);
    await db().user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    await request(admin).get("/api/admin/probe").set("Cookie", cookie).expect(204);
  });

  it("checks origins on all auth writes and accepts a trusted referer as fallback", async () => {
    for (const route of ["/register", "/login", "/logout"]) {
      await api.post(auth + route).expect(403);
      await api.post(auth + route).set("Origin", "null").set("Referer", origin + "/auth").expect(403);
      await api.post(auth + route).set("Origin", "https://other.invalid").expect(403);
    }
    await api.post(auth + "/logout").set("Referer", "invalid").expect(403);
    await api.post(auth + "/logout").set("Referer", "blob:" + origin + "/id").expect(403);
    await api.post(auth + "/logout").set("Referer", origin + "/auth").expect(204);
  });

  it("requires secure cookies in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(cookieOptions().secure).toBe(true);
    } finally {
      vi.stubEnv("NODE_ENV", "test");
    }
  });
});
