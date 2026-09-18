import { hashPassword } from "./auth-service.js";

export async function createLocalTestAccount(env = process.env) {
  const allowed = env.APP_ENV === "local" || env.NODE_ENV === "test";
  if (!allowed || env.NODE_ENV === "production") throw new Error("LOCAL_TEST_ACCOUNT_FORBIDDEN");
  const password = String(env.LOCAL_TEST_PASSWORD || "");
  if (password.length < 8) throw new Error("LOCAL_TEST_PASSWORD_REQUIRED");
  return { username: "testing", passwordHash: await hashPassword(password) };
}
