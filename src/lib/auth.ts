import crypto from "node:crypto";
import { promisify } from "node:util";
import { db } from "@/db";
import { users, sessions, passwordResetTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { User } from "./types";

const scryptAsync = promisify(crypto.scrypt);

export const SESSION_COOKIE_NAME = "auth_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ---------------------------------------------------------------------------
// Cryptographic Password Hashing (scrypt + timingSafeEqual)
// ---------------------------------------------------------------------------
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  combinedHash: string,
): Promise<boolean> {
  const [salt, key] = combinedHash.split(":");
  if (!salt || !key) return false;
  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  if (keyBuffer.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------
export async function createSession(
  userId: number,
): Promise<{ id: string; expiresAt: Date }> {
  const id = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt,
  });
  return { id, expiresAt };
}

export async function validateSession(
  sessionId: string,
): Promise<User | null> {
  if (!sessionId) return null;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!row) return null;

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  return {
    id: row.userId,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
  };
}

export async function destroySession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function destroyUserSessions(userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// Helper to extract session token from cookie header or Next.js headers
export async function getSessionToken(req?: Request): Promise<string | null> {
  if (req) {
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(
        new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`),
      );
      if (match) return decodeURIComponent(match[1]);
    }
  }

  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const c = cookieStore.get(SESSION_COOKIE_NAME);
    return c?.value ?? null;
  } catch {
    return null;
  }
}

export async function getSessionUser(req?: Request): Promise<User | null> {
  const token = await getSessionToken(req);
  if (!token) return null;
  return validateSession(token);
}

// ---------------------------------------------------------------------------
// Registration & Login
// ---------------------------------------------------------------------------
export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: User; session: { id: string; expiresAt: Date } }> {
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  const password = input.password;

  if (!name || name.length < 2) {
    throw new Error("Name must be at least 2 characters.");
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Valid email address is required.");
  }
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    throw new Error("An account with this email already exists.");
  }

  const passwordHash = await hashPassword(password);
  const [row] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash,
    })
    .returning();

  const session = await createSession(row.id);
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: row.createdAt ? String(row.createdAt) : undefined,
      updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
    },
    session,
  };
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ user: User; session: { id: string; expiresAt: Date } }> {
  const email = input.email?.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!row) {
    throw new Error("Invalid email or password.");
  }

  const valid = await verifyPassword(password, row.passwordHash);
  if (!valid) {
    throw new Error("Invalid email or password.");
  }

  const session = await createSession(row.id);
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      createdAt: row.createdAt ? String(row.createdAt) : undefined,
      updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
    },
    session,
  };
}

// ---------------------------------------------------------------------------
// Password Reset Flow
// ---------------------------------------------------------------------------
export async function createPasswordResetToken(
  email: string,
): Promise<{ token: string; email: string } | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (!user) return null;

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour validity

  await db.insert(passwordResetTokens).values({
    userId: user.id,
    token,
    expiresAt,
  });

  return { token, email: user.email };
}

export async function verifyPasswordResetToken(
  token: string,
): Promise<{ valid: boolean; error?: string; userId?: number }> {
  if (!token) return { valid: false, error: "Reset token is required." };
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, token))
    .limit(1);

  if (!row) return { valid: false, error: "Invalid or expired reset token." };
  if (row.usedAt)
    return { valid: false, error: "Reset token has already been used." };
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return { valid: false, error: "Reset token has expired." };
  }

  return { valid: true, userId: row.userId };
}

export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const check = await verifyPasswordResetToken(token);
  if (!check.valid || !check.userId) {
    return { ok: false, error: check.error ?? "Invalid token." };
  }

  if (!newPassword || newPassword.length < 8) {
    return {
      ok: false,
      error: "Password must be at least 8 characters long.",
    };
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, check.userId));

  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.token, token));

  // Invalidate all previous sessions for security upon password reset
  await destroyUserSessions(check.userId);

  return { ok: true };
}
