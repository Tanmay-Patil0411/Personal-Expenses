import { beforeAll, describe, expect, it } from "vitest";
import {
  lastDayOfMonth,
  calendarDaysInPeriod,
  calculateReportKpis,
  calculateCategoryBreakdown,
  generateCategoryExplanation,
  calculatePaymentMethodBreakdown,
  calculateSpendingPatterns,
  calculateBudgetPerformance,
  generateReportInsights,
  buildReport,
} from "@/lib/reportService";
import type { Transaction, Budget } from "@/lib/types";
import { resetTestSchema } from "@/db/test-utils";
import { createTransaction } from "@/lib/transactionService";
import { createBudget } from "@/lib/budgetService";
import { registerUser } from "@/lib/auth";

function createTx(
  id: number,
  date: string,
  type: "Income" | "Expense",
  amount: number,
  category: string,
  method = "Cash",
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

describe("Report Service - Pure Calculations & Acceptance Rules", () => {
  describe("Date utilities & calendar day calculations", () => {
    it("computes last day of month accurately for all months including leap years", () => {
      expect(lastDayOfMonth("2026-01")).toBe("2026-01-31");
      expect(lastDayOfMonth("2026-02")).toBe("2026-02-28"); // non-leap year
      expect(lastDayOfMonth("2024-02")).toBe("2024-02-29"); // leap year
      expect(lastDayOfMonth("2026-04")).toBe("2026-04-30");
      expect(lastDayOfMonth("2026-10")).toBe("2026-10-31");
      expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
    });

    it("calculates exact calendar days in any period", () => {
      expect(calendarDaysInPeriod("2026-10-01", "2026-10-31")).toBe(31);
      expect(calendarDaysInPeriod("2026-02-01", "2026-02-28")).toBe(28);
      expect(calendarDaysInPeriod("2024-02-01", "2024-02-29")).toBe(29);
      expect(calendarDaysInPeriod("2026-01-01", "2026-12-31")).toBe(365);
    });
  });

  describe("KPI Calculations & Section 2 Financial Rules", () => {
    it("excludes income transactions from expense totals and calculates net cash flow", () => {
      const txns: Transaction[] = [
        createTx(1, "2026-10-05", "Income", 50000, "Salary", "Bank Transfer"),
        createTx(2, "2026-10-10", "Expense", 12000, "Housing", "Bank Transfer"),
        createTx(3, "2026-10-15", "Expense", 4500, "Food", "UPI"),
        createTx(4, "2026-10-20", "Expense", 1500, "Transport", "Credit Card"),
      ];

      const kpis = calculateReportKpis(txns, 31);
      expect(kpis.totalIncome).toBe(50000);
      expect(kpis.totalExpenses).toBe(18000); // 12000 + 4500 + 1500
      expect(kpis.netCashFlow).toBe(32000); // 50000 - 18000
      expect(kpis.netSavings).toBe(32000);
      expect(kpis.savingsRate).toBe(64); // (32000 / 50000) * 100 = 64.0%
      expect(kpis.savingsRateStatus).toBe("valid");
    });

    it("handles zero income correctly without misleading percentages", () => {
      const txns: Transaction[] = [
        createTx(1, "2026-10-05", "Expense", 2500, "Food", "Cash"),
        createTx(2, "2026-10-10", "Expense", 1500, "Utilities", "UPI"),
      ];

      const kpis = calculateReportKpis(txns, 31);
      expect(kpis.totalIncome).toBe(0);
      expect(kpis.totalExpenses).toBe(4000);
      expect(kpis.savingsRate).toBeNull();
      expect(kpis.savingsRateStatus).toBe("no_income");
      expect(kpis.savingsRateLabel).toBe("Not available — no income recorded");
    });

    it("calculates average expense per transaction on expense transactions only", () => {
      const txns: Transaction[] = [
        createTx(1, "2026-10-01", "Income", 100000, "Salary"),
        createTx(2, "2026-10-05", "Expense", 3000, "Groceries"),
        createTx(3, "2026-10-12", "Expense", 1000, "Entertainment"),
      ];

      const kpis = calculateReportKpis(txns, 31);
      expect(kpis.expenseTransactionsCount).toBe(2);
      expect(kpis.avgExpensePerTransaction).toBe(2000); // 4000 / 2
    });

    it("calculates average daily spending using calendar days and active days separately", () => {
      const txns: Transaction[] = [
        createTx(1, "2026-10-05", "Expense", 3100, "Groceries"),
        createTx(2, "2026-10-05", "Expense", 3100, "Shopping"),
      ];
      // Total expenses = 6200. Calendar days = 31. Active days = 1 (Oct 5).
      const kpis = calculateReportKpis(txns, 31);
      expect(kpis.calendarDays).toBe(31);
      expect(kpis.activeSpendingDays).toBe(1);
      expect(kpis.zeroSpendingDays).toBe(30);
      expect(kpis.avgDailySpend).toBe(200); // 6200 / 31
      expect(kpis.avgDailyActiveSpend).toBe(6200); // 6200 / 1
    });

    it("identifies highest single expense ignoring larger income transactions", () => {
      const txns: Transaction[] = [
        createTx(1, "2026-10-01", "Income", 95000, "Salary"),
        createTx(2, "2026-10-05", "Expense", 15000, "Housing", "Bank Transfer", "Monthly rent"),
        createTx(3, "2026-10-10", "Expense", 2500, "Food"),
      ];

      const kpis = calculateReportKpis(txns, 31);
      expect(kpis.highestExpense).not.toBeNull();
      expect(kpis.highestExpense?.amount).toBe(15000);
      expect(kpis.highestExpense?.category).toBe("Housing");
      expect(kpis.highestExpense?.description).toBe("Monthly rent");
    });

    it("handles comparison with previous period when data exists", () => {
      const currentTxns: Transaction[] = [
        createTx(1, "2026-10-05", "Expense", 20000, "Housing"),
        createTx(2, "2026-10-10", "Income", 60000, "Salary"),
      ];
      const prevTxns: Transaction[] = [
        createTx(3, "2026-09-05", "Expense", 15000, "Housing"),
        createTx(4, "2026-09-10", "Income", 50000, "Salary"),
      ];

      const kpis = calculateReportKpis(currentTxns, 31, prevTxns, "September 2026");
      expect(kpis.previousPeriod?.hasData).toBe(true);
      expect(kpis.previousPeriod?.expenseDiff).toBe(5000); // 20000 - 15000
      expect(kpis.previousPeriod?.expenseDiffPct).toBeCloseTo(33.3, 1);
      expect(kpis.previousPeriod?.incomeDiff).toBe(10000); // 60000 - 50000
      expect(kpis.previousPeriod?.incomeDiffPct).toBeCloseTo(20.0, 1);
    });

    it("handles missing previous period cleanly without crashing or inventing figures", () => {
      const currentTxns: Transaction[] = [
        createTx(1, "2026-10-05", "Expense", 5000, "Food"),
      ];
      const kpis = calculateReportKpis(currentTxns, 31, [], "September 2026");
      expect(kpis.previousPeriod?.hasData).toBe(false);
      expect(kpis.previousPeriod?.expenseDiffPct).toBeNull();
    });
  });

  describe("Category Analysis & Reconciliation", () => {
    it("reconciles category totals with total expenses and computes averages and percentages", () => {
      const expenseTxns: Transaction[] = [
        createTx(1, "2026-10-02", "Expense", 3000, "Food", "Cash", "Dinner"),
        createTx(2, "2026-10-05", "Expense", 2000, "Food", "UPI", "Lunch"),
        createTx(3, "2026-10-10", "Expense", 5000, "Transport", "Credit Card", "Train ticket"),
      ];
      const totalExpenses = 10000;

      const categories = calculateCategoryBreakdown(expenseTxns, totalExpenses);
      expect(categories.length).toBe(2);

      // Reconciles exactly to 10000
      const sum = categories.reduce((acc, c) => acc + c.total, 0);
      expect(sum).toBe(10000);

      const food = categories.find((c) => c.category === "Food");
      expect(food?.total).toBe(5000);
      expect(food?.percentage).toBe(50);
      expect(food?.transactionCount).toBe(2);
      expect(food?.avgTransactionAmount).toBe(2500);
      expect(food?.highestTransaction?.amount).toBe(3000);
      expect(food?.highestTransaction?.description).toBe("Dinner");

      const transport = categories.find((c) => c.category === "Transport");
      expect(transport?.total).toBe(5000);
      expect(transport?.percentage).toBe(50);
      expect(transport?.transactionCount).toBe(1);
    });

    it("generates dynamic data-driven category explanation without hardcoded names", () => {
      const expenseTxns: Transaction[] = [
        createTx(1, "2026-10-02", "Expense", 4000, "Food"),
        createTx(2, "2026-10-05", "Expense", 1000, "Transport"),
      ];
      const categories = calculateCategoryBreakdown(expenseTxns, 5000);
      const explanation = generateCategoryExplanation(categories, 5000, "October 2026");

      expect(explanation).toContain("Food accounted for 80.0% of your total expenses");
      expect(explanation).toContain("highest spending category");
      expect(explanation).toContain("Transport");
    });
  });

  describe("Payment Method Breakdown & Reconciliation", () => {
    it("ensures all payment method totals add up to total expenses and handles unspecified methods", () => {
      const expenseTxns: Transaction[] = [
        createTx(1, "2026-10-02", "Expense", 3500, "Shopping", "Credit Card"),
        createTx(2, "2026-10-05", "Expense", 1500, "Groceries", "UPI"),
        createTx(3, "2026-10-10", "Expense", 1000, "Food", ""), // empty payment method
      ];
      const totalExpenses = 6000;

      const { items, reconciled } = calculatePaymentMethodBreakdown(expenseTxns, totalExpenses);
      expect(reconciled).toBe(true);

      const sum = items.reduce((acc, p) => acc + p.total, 0);
      expect(sum).toBe(6000);

      const unspecified = items.find((p) => p.method === "Unspecified / Other");
      expect(unspecified?.total).toBe(1000);
    });
  });

  describe("Spending Patterns, Trends & Anomalies", () => {
    it("distinguishes zero-spending days from active days and identifies highest/lowest spending days", () => {
      const expenseTxns: Transaction[] = [
        createTx(1, "2026-10-05", "Expense", 4500, "Food"),
        createTx(2, "2026-10-12", "Expense", 1200, "Transport"),
        createTx(3, "2026-10-12", "Expense", 300, "Food"),
      ];

      const { dailySpending, patterns } = calculateSpendingPatterns(
        expenseTxns,
        "2026-10-01",
        "2026-10-15",
        expenseTxns,
      );

      // 15 days in period
      expect(dailySpending.length).toBe(15);
      expect(patterns.zeroSpendingDaysCount).toBe(13); // 15 - 2 active days
      expect(patterns.highestSpendingDay?.date).toBe("2026-10-05");
      expect(patterns.highestSpendingDay?.amount).toBe(4500);

      // Lowest active day is Oct 12 with 1500 (1200 + 300)
      expect(patterns.lowestSpendingDayActive?.date).toBe("2026-10-12");
      expect(patterns.lowestSpendingDayActive?.amount).toBe(1500);
    });

    it("calculates spending concentration across top categories", () => {
      const expenseTxns: Transaction[] = [
        createTx(1, "2026-10-01", "Expense", 5000, "Housing"),
        createTx(2, "2026-10-02", "Expense", 3000, "Food"),
        createTx(3, "2026-10-03", "Expense", 1000, "Transport"),
        createTx(4, "2026-10-04", "Expense", 1000, "Shopping"),
      ];
      // Total = 10000. Top 1 = Housing (50%). Top 3 = Housing (5000) + Food (3000) + Transport/Shopping (1000) = 9000 (90%)
      const { patterns } = calculateSpendingPatterns(
        expenseTxns,
        "2026-10-01",
        "2026-10-05",
        expenseTxns,
      );
      expect(patterns.spendingConcentration.top1Category).toBe("Housing");
      expect(patterns.spendingConcentration.top1Percentage).toBe(50);
      expect(patterns.spendingConcentration.top3Percentage).toBe(90);
    });
  });

  describe("Budget Performance Evaluation", () => {
    it("handles unconfigured budgets clearly without treating them as zero", () => {
      const result = calculateBudgetPerformance("2026-10", 8500, {}, []);
      expect(result.hasBudget).toBe(false);
      expect(result.overallBudget).toBeNull();
      expect(result.status).toBe("not_configured");
      expect(result.statusLabel).toBe("Not Configured");
      expect(result.explanation).toContain("No budget configured for this period");
    });

    it("reports within_budget, near_limit, and over_budget accurately", () => {
      const budgetOk: Budget = { id: 1, month: "2026-10", category: null, budgetAmount: 10000 };
      const statusOk = calculateBudgetPerformance("2026-10", 6000, {}, [budgetOk], 80);
      expect(statusOk.status).toBe("within_budget");
      expect(statusOk.remaining).toBe(4000);
      expect(statusOk.utilization).toBe(60);

      const statusWarning = calculateBudgetPerformance("2026-10", 8500, {}, [budgetOk], 80);
      expect(statusWarning.status).toBe("near_limit");
      expect(statusWarning.utilization).toBe(85);

      const statusExceeded = calculateBudgetPerformance("2026-10", 12500, {}, [budgetOk], 80);
      expect(statusExceeded.status).toBe("over_budget");
      expect(statusExceeded.overBudgetAmount).toBe(2500);
      expect(statusExceeded.remaining).toBe(-2500);
    });
  });

  describe("Smart Insights Generation", () => {
    it("generates actionable insights with supporting numbers and potential savings", () => {
      const kpis = calculateReportKpis(
        [
          createTx(1, "2026-10-01", "Expense", 15000, "Food"),
          createTx(2, "2026-10-02", "Expense", 5000, "Entertainment"),
        ],
        31,
        [createTx(3, "2026-09-01", "Expense", 12000, "Food")],
        "September 2026",
      );

      const categories = calculateCategoryBreakdown(
        [
          createTx(1, "2026-10-01", "Expense", 15000, "Food"),
          createTx(2, "2026-10-02", "Expense", 5000, "Entertainment"),
        ],
        20000,
        [createTx(3, "2026-09-01", "Expense", 12000, "Food")],
        true,
      );

      const budget = calculateBudgetPerformance("2026-10", 20000, { Food: 15000, Entertainment: 5000 }, [
        { id: 1, month: "2026-10", category: null, budgetAmount: 18000 },
      ]);

      const patterns = calculateSpendingPatterns(
        [
          createTx(1, "2026-10-01", "Expense", 15000, "Food"),
          createTx(2, "2026-10-02", "Expense", 5000, "Entertainment"),
        ],
        "2026-10-01",
        "2026-10-31",
        [],
      );

      const forecast = {
        targetMonth: "2026-11",
        targetMonthLabel: "November 2026",
        predictedExpense: 22000,
        status: "ready",
        method: "LSTM",
        explanation: "",
        historicalSeries: [],
        modelDetails: null,
        baselineComparison: null,
        forecastVsBudget: null,
        plainEnglishSummary: "",
      };

      const insights = generateReportInsights(kpis, categories, budget, forecast, patterns.patterns);
      expect(insights.length).toBeGreaterThan(0);

      const foodIncrease = insights.find((i) => i.id.includes("increased-category-Food"));
      expect(foodIncrease).toBeDefined();
      expect(foodIncrease?.recommendation).toContain("Reviewing food purchases");

      const budgetAlert = insights.find((i) => i.id === "budget-exceeded");
      expect(budgetAlert).toBeDefined();

      const shortfall = insights.find((i) => i.id === "forecast-shortfall");
      expect(shortfall).toBeDefined();
    });
  });
});

describe("Report Service - Database Integration & Multi-User Isolation", () => {
  let userAId: number;
  let userBId: number;

  beforeAll(async () => {
    await resetTestSchema();

    const regA = await registerUser({
      name: "User Alpha",
      email: "alpha@report-test.com",
      password: "Password123!",
    });
    userAId = regA.user.id;

    const regB = await registerUser({
      name: "User Beta",
      email: "beta@report-test.com",
      password: "Password123!",
    });
    userBId = regB.user.id;

    // Seed User A transactions
    await createTransaction(
      {
        transactionDate: "2026-10-05",
        transactionType: "Income",
        amount: 80000,
        category: "Salary",
        paymentMethod: "Bank Transfer",
        description: "Monthly salary",
      },
      userAId,
    );

    await createTransaction(
      {
        transactionDate: "2026-10-08",
        transactionType: "Expense",
        amount: 18000,
        category: "Housing",
        paymentMethod: "Bank Transfer",
        description: "Apartment rent",
      },
      userAId,
    );

    await createTransaction(
      {
        transactionDate: "2026-10-15",
        transactionType: "Expense",
        amount: 6500,
        category: "Food",
        paymentMethod: "UPI",
        description: "Groceries & dining",
      },
      userAId,
    );

    // Seed User A budget
    await createBudget(
      {
        month: "2026-10",
        budgetAmount: 30000,
      },
      userAId,
    );

    // Seed User B transaction (must NOT appear in User A's report)
    await createTransaction(
      {
        transactionDate: "2026-10-10",
        transactionType: "Expense",
        amount: 99999,
        category: "Travel",
        paymentMethod: "Credit Card",
        description: "User B trip",
      },
      userBId,
    );
  });

  it("builds a complete report for User A with multi-user isolation", async () => {
    const report = await buildReport(
      { mode: "monthly", month: "2026-10" },
      userAId,
      { name: "User Alpha", email: "alpha@report-test.com" },
    );

    expect(report.meta.userName).toBe("User Alpha");
    expect(report.meta.periodLabel).toBe("October 2026");
    expect(report.meta.calendarDays).toBe(31);

    // Financial KPIs verification
    expect(report.kpis.totalIncome).toBe(80000);
    expect(report.kpis.totalExpenses).toBe(24500); // 18000 + 6500 (strictly excluding User B's 99999)
    expect(report.kpis.netCashFlow).toBe(55500);
    expect(report.kpis.savingsRate).toBeCloseTo(69.4, 1);

    // Category reconciliation
    expect(report.byCategory.length).toBe(2);
    const catSum = report.byCategory.reduce((acc, c) => acc + c.total, 0);
    expect(catSum).toBe(24500);

    // Payment method reconciliation
    expect(report.paymentMethodReconciled).toBe(true);
    const paySum = report.byPaymentMethod.reduce((acc, p) => acc + p.total, 0);
    expect(paySum).toBe(24500);

    // Budget performance
    expect(report.budgetPerformance.hasBudget).toBe(true);
    expect(report.budgetPerformance.overallBudget).toBe(30000);
    expect(report.budgetPerformance.remaining).toBe(5500); // 30000 - 24500
    expect(report.budgetPerformance.status).toBe("near_limit"); // 24500 / 30000 = 81.7% >= 80%

    // Transaction appendix isolation
    expect(report.transactions.length).toBe(3); // 1 income + 2 expenses for User A
    expect(report.transactions.some((t) => t.amount === 99999)).toBe(false);
  });

  it("handles empty reporting period gracefully", async () => {
    const report = await buildReport(
      { mode: "monthly", month: "2025-01" },
      userAId,
    );
    expect(report.kpis.totalIncome).toBe(0);
    expect(report.kpis.totalExpenses).toBe(0);
    expect(report.kpis.netCashFlow).toBe(0);
    expect(report.kpis.savingsRateStatus).toBe("no_income");
    expect(report.byCategory.length).toBe(0);
    expect(report.transactions.length).toBe(0);
  });
});
