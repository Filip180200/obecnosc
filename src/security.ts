
import {
  createHash,
  createHmac,
  timingSafeEqual
} from "node:crypto";
import type { AppConfig } from "./types.js";

export const ADMIN_COOKIE_NAME = "__Host-attendance_admin";

function equalBuffers(one: Buffer, two: Buffer): boolean {
  return one.length === two.length && timingSafeEqual(one, two);
}

export function constantEqual(one: string, two: string): boolean {
  return equalBuffers(
    createHash("sha256").update(one).digest(),
    createHash("sha256").update(two).digest()
  );
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function signatureBuffer(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const buffer = Buffer.from(value, "base64url");
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

export function createAdminSession(
  config: Pick<AppConfig, "authSecret" | "adminSessionSeconds">,
  nowSeconds: number,
  sessionVersion: number
): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: nowSeconds + config.adminSessionSeconds,
      ver: sessionVersion
    }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${sign(config.authSecret, payload)}`;
}

export function verifyAdminSession(
  config: Pick<AppConfig, "authSecret">,
  token: string | undefined,
  nowSeconds: number,
  sessionVersion: number
): boolean {
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;

  const actualSignature = signatureBuffer(signature);
  const expectedSignature = signatureBuffer(sign(config.authSecret, payload));
  if (
    !actualSignature ||
    !expectedSignature ||
    !equalBuffers(actualSignature, expectedSignature)
  ) {
    return false;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { exp?: unknown; ver?: unknown };
    return (
      typeof decoded.exp === "number" &&
      decoded.exp > nowSeconds &&
      Number.isInteger(decoded.ver) &&
      decoded.ver === sessionVersion
    );
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}; Priority=High`;
}

export function expiredSessionCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Priority=High`;
}

export function readCookie(
  header: string | undefined,
  name: string
): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function clientIp(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return "direct";
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 100);
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return (forwarded || "unknown").slice(0, 100);
}
