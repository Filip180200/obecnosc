import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./types.js";

function equalBuffers(one: Buffer, two: Buffer): boolean {
  return one.length === two.length && timingSafeEqual(one, two);
}

export function constantEqual(one: string, two: string): boolean {
  return equalBuffers(createHash("sha256").update(one).digest(), createHash("sha256").update(two).digest());
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdminSession(config: Pick<AppConfig, "authSecret" | "adminSessionSeconds">, nowSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: nowSeconds + config.adminSessionSeconds }), "utf8").toString("base64url");
  return `${payload}.${sign(config.authSecret, payload)}`;
}

export function verifyAdminSession(config: Pick<AppConfig, "authSecret">, token: string | undefined, nowSeconds: number): boolean {
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = sign(config.authSecret, payload);
  if (!equalBuffers(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof decoded.exp === "number" && decoded.exp > nowSeconds;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, maxAge: number): string {
  return `attendance_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function expiredSessionCookie(): string {
  return "attendance_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function clientIp(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return "direct";
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
