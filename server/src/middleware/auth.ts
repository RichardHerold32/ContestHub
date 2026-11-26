import "dotenv/config";
import type { CookieOptions, Request, RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";
import { sessionUser, type PublicUser } from "../services/auth.js";

declare global {
  namespace Express {
    interface Locals {
      user?: PublicUser;
    }
  }
}

export const cookieName = "contesthub_session";
export function cookieOptions(): CookieOptions {
  return { path: "/api", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" };
}

export function readToken(request: Request): string | undefined {
  const token: unknown = request.cookies?.[cookieName];
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

function clientOrigin() {
  const production = process.env.NODE_ENV === "production";
  const value = process.env.CLIENT_URL ?? (production ? undefined : "http://127.0.0.1:5173");
  if (!value) throw new Error("Set CLIENT_URL to the public HTTPS origin.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || (production && url.protocol !== "https:")) {
    throw new Error("Invalid CLIENT_URL protocol.");
  }
  return url.origin;
}

const trustedOrigin = clientOrigin();
export const requireOrigin: RequestHandler = (request, _response, next) => {
  let origin = request.get("Origin");
  if (origin === undefined) {
    const referer = request.get("Referer") ?? "";
    try {
      if (/^https?:\/\//i.test(referer)) origin = new URL(referer).origin;
    } catch {
      origin = undefined;
    }
  }
  if (origin !== trustedOrigin) throw new HttpError(403, "Untrusted request origin.");
  next();
};

export const requireSession: RequestHandler = async (request, response, next) => {
  const token = readToken(request);
  const user = token && await sessionUser(token);
  if (!user) throw new HttpError(401, "Sign in required.");
  response.locals.user = user;
  next();
};

export const requireAdmin: RequestHandler = (_request, response, next) => {
  if (!response.locals.user) throw new HttpError(401, "Sign in required.");
  if (response.locals.user.role !== "ADMIN") throw new HttpError(403, "Admin access required.");
  next();
};
