import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, expect, it } from "vitest";
import { app } from "../src/app.js";
import { useTestDatabase } from "./database.js";

const db = useTestDatabase();
const api = request(app);
const path = "/api/admin/contests";
const origin = new URL(process.env.CLIENT_URL ?? "http://127.0.0.1:5173").origin;
const draft = {
  title: "A curated round",
  startsAt: "2099-02-01T17:30:00+05:30",
  endsAt: "2099-02-01T19:30:00+05:30",
  sourceUrl: "https://example.invalid/round",
};

async function signIn() {
  const details = { email: randomUUID() + "@example.invalid", password: randomUUID() };
  const registered = await api.post("/api/auth/register").set("Origin", origin).send({ ...details, name: "Editor" }).expect(201);
  const login = await api.post("/api/auth/login").set("Origin", origin).send(details).expect(200);
  return { id: registered.body.user.id as string, cookie: login.get("Set-Cookie")![0].split(";")[0] };
}

let user: Awaited<ReturnType<typeof signIn>>;
let admin: Awaited<ReturnType<typeof signIn>>;
beforeAll(async () => {
  [user, admin] = await Promise.all([signIn(), signIn()]);
  await db().user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
});

const create = (payload: object) => api.post(path).set("Cookie", admin.cookie).set("Origin", origin).send(payload);
const edit = (id: string, payload: object) => api.patch(path + "/" + id).set("Cookie", admin.cookie).set("Origin", origin).send(payload);
const list = () => api.get(path).set("Cookie", admin.cookie);

it.each(["get", "post", "patch"] as const)("checks the session and role on direct %s calls", async (method) => {
  const url = method === "patch" ? path + "/example" : path;
  const call = () => api[method](url).set("Origin", origin);
  await call().expect(401).expect("Cache-Control", "no-store");
  await call().set("Cookie", user.cookie).expect(403).expect("Cache-Control", "no-store");
});

it("rejects untrusted write origins for a valid admin", async () => {
  await api.post(path).set("Cookie", admin.cookie).set("Origin", "https://foreign.invalid").send(draft).expect(403);
  await api.patch(path + "/example").set("Cookie", admin.cookie).send({ isPublished: true }).expect(403);
});

it.each([
  { title: "  " },
  { startsAt: "2099-02-30T17:30:00Z" },
  { startsAt: "2099-02-01T12:00:00" },
  { endsAt: "2099-02-01T12:00:00Z" },
  { endsAt: "2099-02-01T11:00:00Z" },
  { sourceUrl: "javascript:alert(1)" },
  { sourceUrl: "https://user:secret@example.invalid/" },
  { sourceUrl: "/relative" },
  { sourceUrl: "https:///example.invalid" },
  { source: "CODEFORCES" },
  { externalId: "client-chosen" },
])("rejects invalid manual contest fields %j", async (fields) => {
  await create({ ...draft, ...fields }).expect(400);
});

it("creates a draft with a generated identity, then edits, publishes and unpublishes it", async () => {
  const { body } = await create(draft).expect(201).expect("Cache-Control", "no-store");
  expect(body).toMatchObject({ source: "MANUAL", isPublished: false, category: "CODING", description: null,
    startsAt: "2099-02-01T12:00:00.000Z", endsAt: "2099-02-01T14:00:00.000Z" });
  expect(body.externalId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const id: string = body.id;
  const detail = "/api/contests/" + id;
  const browse = "/api/contests?source=MANUAL&search=curated";
  const bookmarks = "/api/me/bookmarks";
  const listed = async () => (await list().expect(200)).body.items.find((item: { id: string }) => item.id === id);
  expect(await listed()).toMatchObject({ id, isPublished: false });
  await api.get(detail).expect(404);
  expect((await api.get(browse).expect(200)).body.items).toEqual([]);
  await edit(id, {}).expect(400);
  await edit(id, { externalId: "override" }).expect(400);
  await edit(id, { startsAt: "2099-02-01T15:00:00Z" }).expect(400);

  const published = await edit(id, { isPublished: true, title: "An edited curated round" }).expect(200);
  expect(published.body).toMatchObject({ id, externalId: body.externalId, isPublished: true, startsAt: body.startsAt, endsAt: body.endsAt });
  const visible = await api.get(detail).expect(200);
  expect(visible.body).toMatchObject({ title: "An edited curated round", source: "MANUAL" });
  expect(visible.body).not.toHaveProperty("isPublished");
  const results = await api.get(browse).expect(200);
  expect(results.body.items).toMatchObject([{ id }]);
  await api.post(bookmarks).set("Cookie", user.cookie).set("Origin", origin).send({ contestId: id }).expect(204);
  expect((await api.get(bookmarks).set("Cookie", user.cookie).expect(200)).body.items).toMatchObject([{ contest: { id } }]);

  await edit(id, { isPublished: false, endsAt: null }).expect(200);
  expect(await listed()).toMatchObject({ id, isPublished: false, endsAt: null });
  await api.get(detail).expect(404);
  expect((await api.get(browse).expect(200)).body.items).toEqual([]);
  await api.get(bookmarks).set("Cookie", user.cookie).expect(200, { userId: user.id, items: [] });
  expect(await db().bookmark.count({ where: { contestId: id } })).toBe(1);
});

it("keeps Codeforces records under importer ownership", async () => {
  const imported = await db().contest.create({
    data: { title: "Imported round", source: "CODEFORCES", externalId: "558", startsAt: new Date(draft.startsAt), sourceUrl: draft.sourceUrl },
  });
  const { body } = await list().expect(200);
  expect(body.items.some((item: { id: string }) => item.id === imported.id)).toBe(false);
  await edit(imported.id, { isPublished: false }).expect(404);
  await edit("unknown-id", { isPublished: false }).expect(404);
  expect(await db().contest.findUnique({ where: { id: imported.id } })).toEqual(imported);
});

it("preserves a valid schedule under concurrent date edits", async () => {
  const { body: { id } } = await create({ ...draft, title: "Concurrent edit round" }).expect(201);
  const edits = await Promise.all([
    edit(id, { startsAt: "2099-02-01T13:30:00Z" }),
    edit(id, { endsAt: "2099-02-01T13:00:00Z" }),
  ]);
  const statuses = edits.map((result) => result.status).sort();
  expect(statuses[0]).toBe(200);
  expect([400, 409]).toContain(statuses[1]);
  const stored = await db().contest.findUniqueOrThrow({ where: { id } });
  expect(stored.endsAt!.getTime()).toBeGreaterThan(stored.startsAt.getTime());
});
