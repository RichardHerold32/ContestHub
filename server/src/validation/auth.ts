import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(1).max(128);

export const registration = z.strictObject({
  name: z.string().trim().min(1).max(120).refine((name) => !name.includes("\0")),
  email,
  password: password.min(12),
});

export const credentials = z.strictObject({ email, password });
