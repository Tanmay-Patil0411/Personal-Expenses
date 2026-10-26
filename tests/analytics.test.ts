import { describe, expect, it } from "vitest";
import {
  computeAnalytics,
  expensesOnly,
  expensesByMonth,
  highestSpendingCategory,
  netCashFlow,
  savingsRate,
  monthOverMonthChange,
  weekKey,
} from "@/lib/analytics";
import type { Transaction } from "@/lib/types";

function t(
  date: string,
  type: "Income" | "Expense",
  amount: number,
  category = "Food",
  method = "Cash",
): Transaction {
  return {
    id: Math.floor(Math.random() * 1e9),
    transactionDate: date,
    transactionType: type,
    amount,
    category,
    paymentMethod: method,
    description: "",
  };
}

describe("analytics engine", () => {
  const sample = [
    t("2025-01-05", "Expense", 100, "Food"),
    t("2025-01-10", "Expense", 50, "Transport"),
    t("2025-02-03", "Expense", 200, "Food"),
    t("2025-01-31", "Income", 1000, "Salary"),
  ];

  it("excludes income from expenses", () => {
    expect(expensesOnly(sample).every((x) => x.transactionType === "Expense")).toBe(true);
  });

  it("computes category totals", () => {
    const a = computeAnalytics(sample);
    const food = a.byCategory.find((c) => c.category === "Food");
    expect(food?.total).toBeCloseTo(300);
    expect(a.byPaymentMethod.length).toBeGreaterThan(0);
  });

  it("aggregates by month", () => {
    const byMonth = expensesByMonth(sample);
    expect(byMonth["2025-01"]).toBeCloseTo(150);
    expect(byMonth["2025-02"]).toBeCloseTo(200);
  });

  it("computes net cash flow & savings rate", () => {
    expect(netCashFlow(1000, 300)).toBe(700);
    expect(savingsRate(1000, 300)).toBeCloseTo(70);
    expect(savingsRate(0, 300)).toBeNull();
  });

  it("finds highest category & largest transaction", () => {
    expect(highestSpendingCategory(sample)?.category).toBe("Food");
    const a = computeAnalytics(sample);
    expect(a.largest?.amount).toBe(200);
  });

  it("handles empty data gracefully", () => {
    const a = computeAnalytics([]);
    expect(a.totalIncome).toBe(0);
    expect(a.totalExpenses).toBe(0);
    expect(a.highestCategory).toBeNull();
    expect(a.momChange).toBeNull();
  });

  it("computes MoM change", () => {
    expect(monthOverMonthChange([150, 200])).toBeCloseTo(33.33, 1);
    expect(monthOverMonthChange([150])).toBeNull();
  });

  it("week key is ISO-ish", () => {
    expect(weekKey("2025-01-06")).toMatch(/\d{4}-W\d{2}/);
  });
});
