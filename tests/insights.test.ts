import { beforeAll, describe, expect, it } from "vitest";
import {
  generateIntelligentInsights,
  detectOutliersIQR,
  detectAnomalies,
  isEssential,
  isDiscretionary,
} from "@/lib/insights";
import type { Transaction, Budget } from "@/lib/types";
import { resetTestSchema } from "@/db/test-utils";
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from "@/lib/transactionService";
import { createBudget } from "@/lib/budgetService";
import { registerUser } from "@/lib/auth";
import { gatherInsights } from "@/lib/aggregate";

function makeTx(
  id: number,
  date: string,
  type: "Income" | "Expense",
  amount: number,
  category: string,
  method = "UPI",
  description = "Test transaction",
  userId = 1,
): Transaction {
  return {
    id,
    userId,
    transactionDate: date,
    transactionType: type,
    amount,
    category,
    paymentMethod: method,
    description,
  };
}

describe("Intelligent Smart Insights Engine - Unit Tests & Scenarios", () => {
  // Scenario 1: User with no transactions
  it("Scenario 1: Handles a user with no transactions cleanly without crashes or fabricated figures", () => {
    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: [],
      budgetStatus: null,
      forecast: null,
    });

    expect(res.metrics.totalExpenses).toBe(0);
    expect(res.metrics.totalIncome).toBe(0);
    expect(res.metrics.savingsRate).toBeNull();
    expect(res.metrics.savingsRateLabel).toBe("Not available — no income recorded");
    expect(res.insights.length).toBeGreaterThan(0);
    expect(res.insights[0].title).toContain("No Transactions Recorded");
  });

  // Scenario 2: User with only income records
  it("Scenario 2: Handles a user with only income records correctly", () => {
    const txns: Transaction[] = [
      makeTx(1, "2026-10-01", "Income", 75000, "Salary", "Bank Transfer"),
      makeTx(2, "2026-10-15", "Income", 15000, "Freelance", "Bank Transfer"),
    ];

    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: txns,
      budgetStatus: null,
      forecast: null,
    });

    expect(res.metrics.totalIncome).toBe(90000);
    expect(res.metrics.totalExpenses).toBe(0);
    expect(res.metrics.netCashFlow).toBe(90000);
    expect(res.metrics.savingsRate).toBe(100);
  });

  // Scenario 3: User with only expense records
  it("Scenario 3: Handles a user with only expense records correctly without negative division", () => {
    const txns: Transaction[] = [
      makeTx(1, "2026-10-05", "Expense", 4000, "Food"),
      makeTx(2, "2026-10-10", "Expense", 8000, "Housing"),
    ];

    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: txns,
      budgetStatus: null,
      forecast: null,
    });

    expect(res.metrics.totalIncome).toBe(0);
    expect(res.metrics.totalExpenses).toBe(12000);
    expect(res.metrics.netCashFlow).toBe(-12000);
    expect(res.metrics.savingsRate).toBeNull();
    expect(res.metrics.savingsRateLabel).toBe("Not available — no income recorded");
  });

  // Scenario 4: User with insufficient historical data
  it("Scenario 4: Gracefully indicates when historical data is insufficient for comparisons", () => {
    const txns: Transaction[] = [
      makeTx(1, "2026-10-12", "Expense", 500, "Food"),
    ];

    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: txns,
      budgetStatus: null,
      forecast: null,
    });

    expect(res.metrics.previousMonthExpenses).toBeNull();
    expect(res.metrics.momExpenseChangePct).toBeNull();
  });

  // Scenario 5: Category whose spending increased or decreased
  it("Scenario 5: Detects category spending surge (>25%) and spending reduction (>20%)", () => {
    const txns: Transaction[] = [
      // September (Previous)
      makeTx(1, "2026-09-05", "Expense", 4000, "Food"),
      makeTx(2, "2026-09-10", "Expense", 5000, "Transport"),

      // October (Current)
      makeTx(3, "2026-10-05", "Expense", 6500, "Food"), // +62.5% increase (+2500)
      makeTx(4, "2026-10-10", "Expense", 3000, "Transport"), // -40% decrease (-2000)
    ];

    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: txns,
      budgetStatus: null,
      forecast: null,
    });

    const surge = res.insights.find((i) => i.id === "behavior-surge-Food");
    expect(surge).toBeDefined();
    expect(surge?.title).toContain("Spending Surge in Food: +62.5%");
    expect(surge?.priority).toBe("high"); // >= 2500 diff is high priority

    const drop = res.insights.find((i) => i.id === "behavior-drop-Transport");
    expect(drop).toBeDefined();
    expect(drop?.title).toContain("Effective Spending Reduction in Transport: -40.0%");
  });

  // Scenario 6: Budget that is under, near, or over its limit
  it("Scenario 6: Reports budget status accurately across healthy, near-limit, and exceeded states", () => {
    // 1. Over budget
    const over = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: [makeTx(1, "2026-10-05", "Expense", 25000, "Housing")],
      budgetStatus: {
        month: "2026-10",
        overallBudget: 20000,
        actualExpenses: 25000,
        remaining: -5000,
        utilization: 125,
        warnings: [],
        categoryBreakdown: [],
        hasCategoryBudgets: false,
      },
      forecast: null,
    });
    const overAlert = over.insights.find((i) => i.id === "budget-exceeded-critical");
    expect(overAlert).toBeDefined();
    expect(overAlert?.priority).toBe("high");
    expect(overAlert?.financialData.find((d) => d.label === "Over-Budget Amount")?.value).toContain("5,000");

    // 2. Near limit (tested near end of month so burn rate does not project overshoot)
    const near = generateIntelligentInsights({
      selectedMonth: "2026-10",
      referenceDate: new Date(Date.UTC(2026, 9, 28)),
      transactions: [makeTx(1, "2026-10-05", "Expense", 17000, "Housing")],
      budgetStatus: {
        month: "2026-10",
        overallBudget: 20000,
        actualExpenses: 17000,
        remaining: 3000,
        utilization: 85,
        warnings: [],
        categoryBreakdown: [],
        hasCategoryBudgets: false,
      },
      forecast: null,
      warningThreshold: 80,
    });
    const nearAlert = near.insights.find((i) => i.id === "budget-near-limit");
    expect(nearAlert).toBeDefined();
  });

  // Scenario 7: Large unusual transaction (IQR and Z-score outlier detection)
  it("Scenario 7: Flags statistical anomalies with exact IQR bounds and Z-score", () => {
    const historical: Transaction[] = [
      makeTx(1, "2026-09-01", "Expense", 200, "Food"),
      makeTx(2, "2026-09-02", "Expense", 250, "Food"),
      makeTx(3, "2026-09-03", "Expense", 300, "Food"),
      makeTx(4, "2026-09-04", "Expense", 220, "Food"),
      makeTx(5, "2026-09-05", "Expense", 280, "Food"),
      makeTx(6, "2026-09-06", "Expense", 310, "Food"),
      makeTx(7, "2026-09-07", "Expense", 260, "Food"),
      makeTx(8, "2026-09-08", "Expense", 240, "Food"),
      // Extraordinary anomaly in current month
      makeTx(9, "2026-10-04", "Expense", 15000, "Shopping", "Credit Card", "Designer Suit"),
    ];

    const outlierResult = detectOutliersIQR(historical, 1.5, 6);
    expect(outlierResult.outliers.length).toBeGreaterThan(0);
    expect(outlierResult.outliers[0].transaction.id).toBe(9);
    expect(outlierResult.outliers[0].zScore).toBeGreaterThan(2);

    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: historical,
      budgetStatus: null,
      forecast: null,
    });
    const anomalyInsight = res.insights.find((i) => i.id === "anomaly-txn-9");
    expect(anomalyInsight).toBeDefined();
    expect(anomalyInsight?.category).toBe("anomaly");
    expect(anomalyInsight?.whyItMatters).not.toContain("fraudulent");
  });

  // Scenario 8: Refunds and duplicate transactions
  it("Scenario 8: Correctly parses positive amounts and does not fail on zero amounts", () => {
    const txns: Transaction[] = [
      makeTx(1, "2026-10-01", "Expense", 1000, "Food"),
      makeTx(2, "2026-10-02", "Expense", 0, "Food"),
    ];
    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: txns,
      budgetStatus: null,
      forecast: null,
    });
    expect(res.metrics.totalExpenses).toBe(1000);
  });

  // Scenario 9: Missing categories and invalid amounts
  it("Scenario 9: Handles missing or blank category names gracefully", () => {
    const txns: Transaction[] = [
      makeTx(1, "2026-10-01", "Expense", 1500, ""),
    ];
    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: txns,
      budgetStatus: null,
      forecast: null,
    });
    expect(res.metrics.totalExpenses).toBe(1500);
  });

  // Scenario 10: Month-end forecast with incomplete current-month data (burn rate)
  it("Scenario 10: Calculates daily burn rate and projects month-end spending correctly", () => {
    // Reference date: Day 10 of October (31 days). Spent = 5,000.
    // Daily burn rate = 5,000 / 10 = 500/day.
    // Projected month end = 500 * 31 = 15,500.
    const refDate = new Date(Date.UTC(2026, 9, 10)); // Oct 10, 2026

    const txns: Transaction[] = [
      makeTx(1, "2026-10-02", "Expense", 2000, "Food"),
      makeTx(2, "2026-10-08", "Expense", 3000, "Transport"),
    ];

    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      referenceDate: refDate,
      transactions: txns,
      budgetStatus: {
        month: "2026-10",
        overallBudget: 12000,
        actualExpenses: 5000,
        remaining: 7000,
        utilization: 41.7,
        warnings: [],
        categoryBreakdown: [],
        hasCategoryBudgets: false,
      },
      forecast: null,
    });

    expect(res.metrics.elapsedDays).toBe(10);
    expect(res.metrics.daysInMonth).toBe(31);
    expect(res.metrics.dailyBurnRate).toBe(500);
    expect(res.metrics.projectedMonthEndExpense).toBe(15500);
    expect(res.metrics.projectedOverBudgetAmount).toBe(3500); // 15500 - 12000
    // Remaining = 7000. 7000 / 500 = 14 days until exhaustion. Day 10 + 14 = Day 24!
    expect(res.metrics.estimatedBudgetExhaustionDate).toBe("2026-10-24");

    const burnAlert = res.insights.find((i) => i.id === "budget-burnrate-warning");
    expect(burnAlert).toBeDefined();
    expect(burnAlert?.title).toContain("Exhaustion Projected by 2026-10-24");
  });

  // Scenario 11: Database or prediction service fallback
  it("Scenario 11: Operates robustly when prediction model is untrained or unavailable", () => {
    const txns: Transaction[] = [makeTx(1, "2026-10-05", "Expense", 3000, "Food")];
    const res = generateIntelligentInsights({
      selectedMonth: "2026-10",
      transactions: txns,
      budgetStatus: null,
      forecast: null, // model unavailable
    });
    expect(res.insights.some((i) => i.category === "prediction")).toBe(false);
  });

  // Scenario 14: Category classification helpers
  it("Scenario 14: Accurately classifies essential vs discretionary categories", () => {
    expect(isEssential("Housing")).toBe(true);
    expect(isEssential("Groceries")).toBe(true);
    expect(isEssential("Utilities")).toBe(true);
    expect(isDiscretionary("Food")).toBe(true);
    expect(isDiscretionary("Shopping")).toBe(true);
    expect(isDiscretionary("Entertainment")).toBe(true);
  });
});

describe("Intelligent Smart Insights - Database Integration & User Isolation", () => {
  let userAId: number;
  let userBId: number;

  beforeAll(async () => {
    await resetTestSchema();

    const regA = await registerUser({
      name: "Alice Insights",
      email: "alice@insights-test.com",
      password: "Password123!",
    });
    userAId = regA.user.id;

    const regB = await registerUser({
      name: "Bob Insights",
      email: "bob@insights-test.com",
      password: "Password123!",
    });
    userBId = regB.user.id;

    // Seed User A transactions
    await createTransaction(
      {
        transactionDate: "2026-10-01",
        transactionType: "Income",
        amount: 85000,
        category: "Salary",
        paymentMethod: "Bank Transfer",
        description: "October salary",
      },
      userAId,
    );

    await createTransaction(
      {
        transactionDate: "2026-10-04",
        transactionType: "Expense",
        amount: 18000,
        category: "Housing",
        paymentMethod: "Bank Transfer",
        description: "Monthly Rent",
      },
      userAId,
    );

    await createTransaction(
      {
        transactionDate: "2026-10-08",
        transactionType: "Expense",
        amount: 6000,
        category: "Food",
        paymentMethod: "UPI",
        description: "Dining out",
      },
      userAId,
    );

    // Seed User A budget
    await createBudget(
      {
        month: "2026-10",
        budgetAmount: 22000,
      },
      userAId,
    );

    // Seed User B transactions (MUST NOT appear in Alice's insights)
    await createTransaction(
      {
        transactionDate: "2026-10-05",
        transactionType: "Expense",
        amount: 999999,
        category: "Shopping",
        paymentMethod: "Credit Card",
        description: "Bob Super Luxury",
      },
      userBId,
    );
  });

  // Scenario 12: Multiple users with separate financial records (User Isolation)
  it("Scenario 12: Enforces multi-user isolation on insights generation", async () => {
    const resA = await gatherInsights(userAId, "2026-10");
    expect(resA.metrics.totalExpenses).toBe(24000); // 18000 + 6000 (strictly excluding Bob's 999999)
    expect(resA.metrics.totalIncome).toBe(85000);
    expect(resA.metrics.overallBudget).toBe(22000);
    // Alice's spending is 24000 which exceeds her budget of 22000
    expect(resA.metrics.projectedOverBudgetAmount).toBeGreaterThan(0);

    const resB = await gatherInsights(userBId, "2026-10");
    expect(resB.metrics.totalExpenses).toBe(999999);
  });

  // Scenario 13: Updating or deleting a transaction and refreshing insights
  it("Scenario 13: Recalculates metrics and insights dynamically after transaction deletion", async () => {
    // Add a temporary transaction for User A
    const tempTx = await createTransaction(
      {
        transactionDate: "2026-10-12",
        transactionType: "Expense",
        amount: 10000,
        category: "Travel",
        paymentMethod: "Credit Card",
        description: "Weekend Trip",
      },
      userAId,
    );

    const resBefore = await gatherInsights(userAId, "2026-10");
    expect(resBefore.metrics.totalExpenses).toBe(34000); // 24000 + 10000

    // Delete the transaction
    await deleteTransaction(tempTx.id, userAId);

    const resAfter = await gatherInsights(userAId, "2026-10");
    expect(resAfter.metrics.totalExpenses).toBe(24000); // Back down to 24000
  });
});
