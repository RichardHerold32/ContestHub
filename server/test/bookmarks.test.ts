import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, expect, it } from "vitest";
import { app } from "../src/app.js";
import { useTestDatabase } from "./database.js";

const db = useTestDatabase();
const api = request(app);
const path = "/api/me/bookmarks";
const origin = new URL(process.env.CLIENT_URL ?? "http://127.0.0.1:5173").origin;

async function account() {
  const credentials = { email: randomUUID() + "@example.invalid", password: randomUUID() };
  await api.post("/api/auth/register").set("Origin", origin).send({ ...credentials, name: "Test reader" }).expect(201);
  const { body, headers } = await api.post("/api/auth/login").set("Origin", origin).send(credentials).expect(200);
  return { id: body.user.id as string, cookie: headers["set-cookie"][0].split(";")[0] as string };
}

let reader: Awaited<ReturnType<typeof account>>;
let other: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  [reader, other] = await Promise.all([account(), account()]);
});

async function contest(isPublished = true) {
  const externalId = randomUUID();
  return db().contest.create({
    data: { source: "MANUAL", externalId, title: "Round " + externalId, startsAt: new Date("2099-01-01T15:00:00Z"),
      sourceUrl: "https://example.invalid/contest", isPublished },
  });
}

const save = (cookie: string, contestId: string) => api.post(path).set("Origin", origin).set("Cookie", cookie).send({ contestId });
const list = (cookie: string) => api.get(path).set("Cookie", cookie);
const remove = (cookie: string, contestId: string) => api.delete(path + "/" + encodeURIComponent(contestId)).set("Origin", origin).set("Cookie", cookie);

it("keeps one row for concurrent and repeated saves", async () => {
  const { id, title } = await contest();
  await Promise.all([save(reader.cookie, id).expect(204), save(reader.cookie, id).expect(204)]);
  const row = await db().bookmark.findUniqueOrThrow({ where: { userId_contestId: { userId: reader.id, contestId: id } } });
  await save(reader.cookie, id).expect(204);
  expect(await db().bookmark.findMany({ where: { contestId: id } })).toEqual([row]);
  const { body } = await list(reader.cookie).expect(200).expect("Cache-Control", "no-store");
  expect(body).toMatchObject({ userId: reader.id, items: [{
    savedAt: row.createdAt.toISOString(),
    contest: { id, title, startsAt: "2099-01-01T15:00:00.000Z", status: "upcoming" },
  }] });
  expect(body.items[0].contest).not.toHaveProperty("externalId");
  await remove(reader.cookie, id).expect(204);
});

it("lists only the session user's records and scopes repeated removal to that user", async () => {
  const shared = await contest();
  const privateContest = await contest();
  await save(reader.cookie, shared.id).expect(204);
  await save(other.cookie, shared.id).expect(204);
  await save(other.cookie, privateContest.id).expect(204);
  const { body } = await api.get(path + "?userId=" + other.id).set("Cookie", reader.cookie).expect(200);
  expect(body.userId).toBe(reader.id);
  expect(body.items.map(({ contest }: { contest: { id: string } }) => contest.id)).toEqual([shared.id]);
  await remove(reader.cookie, privateContest.id).expect(204);
  await remove(reader.cookie, shared.id).expect(204);
  await remove(reader.cookie, shared.id).expect(204);
  await list(reader.cookie).expect(200, { userId: reader.id, items: [] });
  expect(await db().bookmark.count({ where: { userId: other.id } })).toBe(2);
});

it("rejects forged owners, malformed IDs and writes from untrusted origins", async () => {
  const { id } = await contest();
  const post = () => api.post(path).set("Cookie", reader.cookie).set("Origin", origin);
  await post().send({ contestId: id, userId: other.id }).expect(400);
  await post().send({ contestId: 1 }).expect(400);
  await post().send({}).expect(400);
  await post().send({ contestId: " " }).expect(400);
  await remove(reader.cookie, "\0").expect(400);
  await api.post(path).set("Cookie", reader.cookie).set("Origin", "https://foreign.invalid").send({ contestId: id }).expect(403);
  await api.delete(path + "/" + id).set("Cookie", reader.cookie).expect(403);
  expect(await db().bookmark.count({ where: { contestId: id } })).toBe(0);
});

it("hides unpublished contests, restores saves on publication and cascades deleted contests", async () => {
  const { id } = await contest(false);
  await save(reader.cookie, "unknown").expect(404);
  await save(reader.cookie, id).expect(404);
  await db().contest.update({ where: { id }, data: { isPublished: true } });
  await save(reader.cookie, id).expect(204);
  await db().contest.update({ where: { id }, data: { isPublished: false } });
  await list(reader.cookie).expect(200, { userId: reader.id, items: [] });
  expect(await db().bookmark.count({ where: { contestId: id } })).toBe(1);
  await db().contest.update({ where: { id }, data: { isPublished: true } });
  const { body } = await list(reader.cookie).expect(200);
  expect(body.items).toMatchObject([{ contest: { id } }]);
  await db().contest.delete({ where: { id } });
  await list(reader.cookie).expect(200, { userId: reader.id, items: [] });
  expect(await db().bookmark.count({ where: { contestId: id } })).toBe(0);
  await save(reader.cookie, id).expect(404);
  await remove(reader.cookie, id).expect(204);
});

it("rejects signed-out and revoked sessions", async () => {
  const former = await account();
  const { id } = await contest();
  await api.get(path).expect(401).expect("Cache-Control", "no-store");
  await api.post(path).set("Origin", origin).send({ contestId: id }).expect(401);
  await api.delete(path + "/" + id).set("Origin", origin).expect(401);
  await save(former.cookie, id).expect(204);
  await api.post("/api/auth/logout").set("Cookie", former.cookie).set("Origin", origin).expect(204);
  await list(former.cookie).expect(401);
  await save(former.cookie, id).expect(401);
  await remove(former.cookie, id).expect(401);
  expect(await db().bookmark.count({ where: { contestId: id, userId: former.id } })).toBe(1);
});
