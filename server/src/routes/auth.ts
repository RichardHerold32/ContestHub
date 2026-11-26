import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { HttpError } from "../lib/http-error.js";
import { cookieName, cookieOptions, readToken, requireOrigin, requireSession } from "../middleware/auth.js";
import { login, logout, register } from "../services/auth.js";
import { credentials, registration } from "../validation/auth.js";

export const authRouter = Router();

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { message: "Too many login attempts. Try again later." } },
});

authRouter.post("/register", requireOrigin, async (req, res) => {
  const body = registration.safeParse(req.body);
  if (!body.success) throw new HttpError(400, "Provide a name, email and 12–128 character password.");
  const { name, email, password } = body.data;
  res.status(201).json({ user: await register(name, email, password) });
});

authRouter.post("/login", requireOrigin, loginLimit, async (req, res) => {
  const body = credentials.safeParse(req.body);
  if (!body.success) throw new HttpError(400, "Provide a valid email and password.");
  const { user, token, expiresAt } = await login(body.data.email, body.data.password, readToken(req));
  res.cookie(cookieName, token, { ...cookieOptions(), expires: expiresAt }).json({ user });
});

authRouter.get("/me", requireSession, (_req, res) => {
  res.json({ user: res.locals.user });
});

authRouter.post("/logout", requireOrigin, async (req, res) => {
  const token = readToken(req);
  if (token) await logout(token);
  res.clearCookie(cookieName, cookieOptions()).sendStatus(204);
});
