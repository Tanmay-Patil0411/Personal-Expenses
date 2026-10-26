import { describe, it, expect, beforeEach } from "vitest";
import { resetTestSchema } from "@/db/test-utils";
import {
  hashPassword,
  verifyPassword,
  registerUser,
  loginUser,
  createSession,
  validateSession,
  destroySession,
  createPasswordResetToken,
  resetPasswordWithToken,
} from "@/lib/auth";
import {
  createTransaction,
  getTransactions,
  getTransactionById,
  deleteTransaction,
} from "@/lib/transactionService";
import { createBudget, getBudgets } from "@/lib/budgetService";

describe("Authentication & Multi-User Isolation", () => {
  beforeEach(async () => {
    await resetTestSchema();
  });

  describe("Password Hashing", () => {
    it("hashes and verifies passwords correctly using scrypt", async () => {
      const password = "SuperSecretPassword123!";
      const hash = await hashPassword(password);

      expect(hash).toContain(":");
      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      const isWrong = await verifyPassword("WrongPassword123!", hash);
      expect(isWrong).toBe(false);
    });

    it("generates unique salt per hash", async () => {
      const password = "IdenticalPassword123!";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
      expect(await verifyPassword(password, hash1)).toBe(true);
      expect(await verifyPassword(password, hash2)).toBe(true);
    });
  });

  describe("User Registration & Login", () => {
    it("registers a new user and creates an active session", async () => {
      const res = await registerUser({
        name: "Alice Smith",
        email: "alice@example.com",
        password: "Password123!",
      });

      expect(res.user.id).toBeDefined();
      expect(res.user.name).toBe("Alice Smith");
      expect(res.user.email).toBe("alice@example.com");
      expect(res.session.id).toBeDefined();

      const sessionUser = await validateSession(res.session.id);
      expect(sessionUser).not.toBeNull();
      expect(sessionUser?.id).toBe(res.user.id);
    });

    it("rejects duplicate email registrations", async () => {
      await registerUser({
        name: "Bob User",
        email: "bob@example.com",
        password: "Password123!",
      });

      await expect(
        registerUser({
          name: "Bob Duplicate",
          email: "bob@example.com",
          password: "AnotherPassword123!",
        }),
      ).rejects.toThrow(/already exists/i);
    });

    it("validates password length during registration", async () => {
      await expect(
        registerUser({
          name: "Short Pass",
          email: "short@example.com",
          password: "short",
        }),
      ).rejects.toThrow(/at least 8 characters/i);
    });

    it("authenticates existing user on login", async () => {
      await registerUser({
        name: "Carol White",
        email: "carol@example.com",
        password: "ValidPassword123!",
      });

      const loginRes = await loginUser({
        email: "carol@example.com",
        password: "ValidPassword123!",
      });

      expect(loginRes.user.email).toBe("carol@example.com");
      expect(loginRes.session.id).toBeDefined();

      // Wrong password fails
      await expect(
        loginUser({
          email: "carol@example.com",
          password: "WrongPassword!",
        }),
      ).rejects.toThrow(/invalid email or password/i);

      // Non-existent email fails
      await expect(
        loginUser({
          email: "nobody@example.com",
          password: "SomePassword123!",
        }),
      ).rejects.toThrow(/invalid email or password/i);
    });

    it("destroys session upon logout", async () => {
      const { session } = await registerUser({
        name: "Dave Brown",
        email: "dave@example.com",
        password: "Password123!",
      });

      expect(await validateSession(session.id)).not.toBeNull();

      await destroySession(session.id);
      expect(await validateSession(session.id)).toBeNull();
    });

    it("extracts session token from request cookie headers correctly", async () => {
      const { getSessionToken, SESSION_COOKIE_NAME } = await import("@/lib/auth");
      const fakeReq = new Request("http://localhost:3000/login", {
        headers: {
          cookie: `other_cookie=123; ${SESSION_COOKIE_NAME}=test_token_abc123; theme=dark`,
        },
      });

      const token = await getSessionToken(fakeReq);
      expect(token).toBe("test_token_abc123");

      const emptyReq = new Request("http://localhost:3000/login");
      expect(await getSessionToken(emptyReq)).toBeNull();
    });

    it("allows switching accounts by logging in as another user", async () => {
      const userA = await registerUser({
        name: "User Account A",
        email: "switch_a@example.com",
        password: "Password123!",
      });

      const userB = await registerUser({
        name: "User Account B",
        email: "switch_b@example.com",
        password: "Password456!",
      });

      // User A creates session
      const sessionA = await validateSession(userA.session.id);
      expect(sessionA?.id).toBe(userA.user.id);

      // Logging in as User B creates distinct session for User B
      const loginB = await loginUser({
        email: "switch_b@example.com",
        password: "Password456!",
      });

      expect(loginB.user.id).toBe(userB.user.id);
      const sessionB = await validateSession(loginB.session.id);
      expect(sessionB?.id).toBe(userB.user.id);
      expect(sessionB?.email).toBe("switch_b@example.com");
    });
  });

  describe("Password Reset Flow", () => {
    it("generates a reset token and allows updating the password", async () => {
      const { user } = await registerUser({
        name: "Eve Black",
        email: "eve@example.com",
        password: "OriginalPassword123!",
      });

      const tokenRes = await createPasswordResetToken("eve@example.com");
      expect(tokenRes).not.toBeNull();
      expect(tokenRes?.token).toBeDefined();

      // Reset password with token
      const resetRes = await resetPasswordWithToken(
        tokenRes!.token,
        "BrandNewPassword123!",
      );
      expect(resetRes.ok).toBe(true);

      // Old password should now fail
      await expect(
        loginUser({
          email: "eve@example.com",
          password: "OriginalPassword123!",
        }),
      ).rejects.toThrow();

      // New password should succeed
      const newLogin = await loginUser({
        email: "eve@example.com",
        password: "BrandNewPassword123!",
      });
      expect(newLogin.user.id).toBe(user.id);

      // Token cannot be reused
      const secondTry = await resetPasswordWithToken(
        tokenRes!.token,
        "AnotherPassword123!",
      );
      expect(secondTry.ok).toBe(false);
    });
  });

  describe("Multi-User Data Isolation", () => {
    it("ensures User A cannot view, modify, or delete User B's transactions", async () => {
      const userA = await registerUser({
        name: "User A",
        email: "usera@example.com",
        password: "Password123!",
      });

      const userB = await registerUser({
        name: "User B",
        email: "userb@example.com",
        password: "Password123!",
      });

      // User A creates a transaction
      const txnA = await createTransaction(
        {
          transactionDate: "2026-03-10",
          transactionType: "Expense",
          amount: 50.0,
          category: "Food",
          paymentMethod: "UPI",
          description: "User A Lunch",
        },
        userA.user.id,
      );

      // User B creates a transaction
      const txnB = await createTransaction(
        {
          transactionDate: "2026-03-11",
          transactionType: "Expense",
          amount: 150.0,
          category: "Shopping",
          paymentMethod: "Credit Card",
          description: "User B Shoes",
        },
        userB.user.id,
      );

      // User A query returns only User A's transaction
      const listA = await getTransactions({ userId: userA.user.id });
      expect(listA).toHaveLength(1);
      expect(listA[0].id).toBe(txnA.id);
      expect(listA[0].description).toBe("User A Lunch");

      // User B query returns only User B's transaction
      const listB = await getTransactions({ userId: userB.user.id });
      expect(listB).toHaveLength(1);
      expect(listB[0].id).toBe(txnB.id);
      expect(listB[0].description).toBe("User B Shoes");

      // User A cannot fetch User B's transaction by ID
      const attemptA = await getTransactionById(txnB.id, userA.user.id);
      expect(attemptA).toBeNull();

      // User A cannot delete User B's transaction
      await deleteTransaction(txnB.id, userA.user.id);
      // Verify txnB is still present for User B
      const stillThere = await getTransactionById(txnB.id, userB.user.id);
      expect(stillThere).not.toBeNull();
    });

    it("allows different users to have distinct budgets for the same month and category", async () => {
      const userA = await registerUser({
        name: "User A",
        email: "usera_b@example.com",
        password: "Password123!",
      });

      const userB = await registerUser({
        name: "User B",
        email: "userb_b@example.com",
        password: "Password123!",
      });

      // Both set a Food budget for 2026-04 with different amounts
      await createBudget(
        { month: "2026-04", category: "Food", budgetAmount: 300 },
        userA.user.id,
      );

      await createBudget(
        { month: "2026-04", category: "Food", budgetAmount: 650 },
        userB.user.id,
      );

      const budgetsA = await getBudgets("2026-04", userA.user.id);
      expect(budgetsA).toHaveLength(1);
      expect(budgetsA[0].budgetAmount).toBe(300);

      const budgetsB = await getBudgets("2026-04", userB.user.id);
      expect(budgetsB).toHaveLength(1);
      expect(budgetsB[0].budgetAmount).toBe(650);
    });
  });
});
