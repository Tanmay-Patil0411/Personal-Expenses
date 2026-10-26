import { beforeAll, describe, expect, it } from "vitest";
import {
  createTransaction,
  getTransactions,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
} from "@/lib/transactionService";
import { resetTestSchema } from "@/db/test-utils";

const exp = (over: Record<string, unknown> = {}) => ({
  transactionDate: "2025-01-15",
  transactionType: "Expense" as const,
  amount: 42.5,
  category: "Food",
  paymentMethod: "Credit Card",
  description: "Coffee",
  ...over,
});

const inc = (over: Record<string, unknown> = {}) => ({
  transactionDate: "2025-01-31",
  transactionType: "Income" as const,
  amount: 3000,
  category: "Salary",
  paymentMethod: "Bank Transfer",
  description: "Salary",
  ...over,
});

describe("transaction CRUD + validation", () => {
  beforeAll(async () => {
    await resetTestSchema();
  });

  it("adds + retrieves transactions", async () => {
    const t1 = await createTransaction(exp());
    const t2 = await createTransaction(inc());
    const all = await getTransactions();
    expect(all.length).toBe(2);
    const fetched = await getTransactionById(t1.id);
    expect(fetched?.amount).toBeCloseTo(42.5);
    expect(t2.transactionType).toBe("Income");
  });

  it("separates income from expenses", async () => {
    const expenses = await getTransactions({ type: "Expense" });
    const incomes = await getTransactions({ type: "Income" });
    expect(expenses.every((t) => t.transactionType === "Expense")).toBe(true);
    expect(incomes.every((t) => t.transactionType === "Income")).toBe(true);
    // Income never counted as spending
    expect(
      expenses.reduce((a, t) => a + t.amount, 0),
    ).toBeLessThan(3000);
  });

  it("supports search and filters", async () => {
    const found = await getTransactions({ search: "coffee" });
    expect(found.length).toBe(1);
    const filtered = await getTransactions({ category: "Food" });
    expect(filtered.every((t) => t.category === "Food")).toBe(true);
    const method = await getTransactions({ paymentMethod: "Bank Transfer" });
    expect(method.every((t) => t.paymentMethod === "Bank Transfer")).toBe(true);
    const range = await getTransactions({
      startDate: "2025-01-01",
      endDate: "2025-01-15",
    });
    expect(range.every((t) => t.transactionDate <= "2025-01-15")).toBe(true);
  });

  it("edits a transaction", async () => {
    const t = await createTransaction(exp({ description: "Edit me" }));
    const updated = await updateTransaction(t.id, {
      amount: 99.99,
      description: "Edited",
    });
    expect(updated.amount).toBeCloseTo(99.99);
    expect(updated.description).toBe("Edited");
  });

  it("deletes a transaction", async () => {
    const t = await createTransaction(exp({ description: "Delete me" }));
    await deleteTransaction(t.id);
    expect(await getTransactionById(t.id)).toBeNull();
  });

  it("rejects invalid amount, type, date, category, method", async () => {
    await expect(createTransaction(exp({ amount: 0 }))).rejects.toThrow();
    await expect(createTransaction(exp({ amount: -5 }))).rejects.toThrow();
    await expect(
      createTransaction(exp({ amount: "abc" as never })),
    ).rejects.toThrow();
    await expect(
      createTransaction(exp({ transactionType: "Refund" as never })),
    ).rejects.toThrow();
    await expect(
      createTransaction(exp({ transactionDate: "31-01-2025" })),
    ).rejects.toThrow();
    await expect(
      createTransaction(exp({ transactionDate: "not-a-date" })),
    ).rejects.toThrow();
    await expect(
      createTransaction(exp({ category: "RandomCat" })),
    ).rejects.toThrow();
    await expect(
      createTransaction(exp({ paymentMethod: "Barter" })),
    ).rejects.toThrow();
    // income category for expense
    await expect(
      createTransaction(exp({ category: "Salary" })),
    ).rejects.toThrow();
  });

  it("sorting by amount works", async () => {
    await createTransaction(exp({ amount: 10, description: "SORTITEM" }));
    await createTransaction(exp({ amount: 50, description: "SORTITEM" }));
    await createTransaction(exp({ amount: 30, description: "SORTITEM" }));
    const sorted = await getTransactions({
      search: "SORTITEM",
      sortBy: "amount",
      sortDir: "desc",
    });
    expect(sorted.map((s) => s.amount)).toEqual([50, 30, 10]);
  });

  it("allows adding consecutive transactions with empty or omitted externalTransactionId without unique constraint collision", async () => {
    const t1 = await createTransaction({
      transactionDate: "2026-03-01",
      transactionType: "Expense",
      amount: 100,
      category: "Food",
      paymentMethod: "Cash",
      description: "",
      externalTransactionId: "",
    });

    const t2 = await createTransaction({
      transactionDate: "2026-03-02",
      transactionType: "Expense",
      amount: 200,
      category: "Food",
      paymentMethod: "Cash",
      description: "",
      externalTransactionId: "",
    });

    expect(t1.id).toBeDefined();
    expect(t2.id).toBeDefined();
    expect(t1.externalTransactionId).toBeNull();
    expect(t2.externalTransactionId).toBeNull();
  });
});
