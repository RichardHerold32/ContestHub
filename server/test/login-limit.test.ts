import request from "supertest";
import { it } from "vitest";
import { app } from "../src/app.js";

it("limits login to ten attempts per IP in the active window", async () => {
  const origin = new URL(process.env.CLIENT_URL ?? "http://127.0.0.1:5173").origin;
  const login = () => request(app).post("/api/auth/login").set("Origin", origin).send({});
  for (let attempt = 0; attempt < 10; attempt++) await login().expect(400);
  await login().expect("Retry-After", /^\d+$/).expect(429, {
    error: { message: "Too many login attempts. Try again later." },
  });
});
