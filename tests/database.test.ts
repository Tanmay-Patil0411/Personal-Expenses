import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { transactions, budgets } from "@/db/schema";
import { resetTestSchema, getSchema } from "@/db/test-utils";
import { sql } from "drizzle-orm";

describe("database initialization", () => {
  beforeAll(async () => {
    await resetTestSchema();
  });

  it("creates the required tables", async () => {
    const tables = (await getSchema()).map((t) => t.tablename);
    expect(tables).toContain("transactions");
    expect(tables).toContain("budgets");
    expect(tables).toContain("model_runs");
    expect(tables).toContain("predictions");
    expect(tables).toContain("app_settings");
  });

  it("supports inserting and reading a transaction", async () => {
    const [row] = await db
      .insert(transactions)
      .values({
        transactionDate: "2025-01-10",
        transactionType: "Expense",
        amount: "12.50",
        category: "Food",
        paymentMethod: "Credit Card",
        description: "Lunch",
      })
      .returning();
    expect(row.id).toBeGreaterThan(0);
    expect(row.transactionType).toBe("Expense");
    expect(Number(row.amount)).toBeCloseTo(12.5);
  });

  it("enforces NOT NULL / CHECK constraints", async () => {
    await expect(
      db.insert(transactions).values({
        transactionDate: "2025-01-10",
        transactionType: "Expense",
        amount: "-5",
        category: "Food",
        paymentMethod: "Cash",
      }),
    ).rejects.toThrow();
  });

  it("enforces unique external_transaction_id", async () => {
    const payload = {
      transactionDate: "2025-02-01",
      transactionType: "Income" as const,
      amount: "100",
      category: "Salary",
      paymentMethod: "Bank Transfer",
      externalTransactionId: "T-DUP-1",
    };
    await db.insert(transactions).values(payload);
    await expect(db.insert(transactions).values(payload)).rejects.toThrow();
  });

  it("enforces unique budget (month, category)", async () => {
    // NOTE: PostgreSQL treats NULL categories as distinct in a plain unique
    // constraint, so the application layer upserts overall (null) budgets.
    // Here we verify the constraint with a non-null category.
    await db
      .insert(budgets)
      .values({ month: "2025-03", category: "Food", budgetAmount: "500" });
    await expect(
      db.insert(budgets).values({
        month: "2025-03",
        category: "Food",
        budgetAmount: "600",
      }),
    ).rejects.toThrow();
  });

  it("persists data across queries (no SQLite in-memory loss)", async () => {
    const res = await db.execute(
      sql`SELECT count(*)::int AS count FROM transactions`,
    );
    const count = (res.rows[0] as { count: number }).count;
    expect(count).toBeTypeOf("number");
    expect(count).toBeGreaterThan(0);
  });
});
