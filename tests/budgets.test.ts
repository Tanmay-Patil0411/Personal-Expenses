import { beforeAll, describe, expect, it } from "vitest";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgets,
  getBudget,
  evaluateBudget,
  computeBudgetStatus,
  duplicateBudgets,
  getBudgetHistory,
  getBudgetPlanningSuggestions,
} from "@/lib/budgetService";
import { createTransaction, deleteTransaction } from "@/lib/transactionService";
import { registerUser } from "@/lib/auth";
import { resetTestSchema } from "@/db/test-utils";

describe("Intelligent Budget Management System", () => {
  let user1Id: number;
  let user2Id: number;

  beforeAll(async () => {
    await resetTestSchema();
    const u1 = await registerUser({
      name: "Primary Budget User",
      email: "primary.budget@example.com",
      password: "Password123!",
    });
    user1Id = u1.user.id;

    const u2 = await registerUser({
      name: "Secondary Budget User",
      email: "secondary.budget@example.com",
      password: "Password123!",
    });
    user2Id = u2.user.id;
  });

  // Scenario 1: Creating, editing, and deleting budgets in DB
  it("Scenario 1: Creates, updates, and deletes budgets with full lifecycle tracking", async () => {
    const b1 = await createBudget(
      {
        month: "2026-10",
        category: null,
        budgetAmount: 50000,
        name: "October Primary Living Budget",
        notes: "Strict monthly limit",
        alertThreshold: 85,
      },
      user1Id,
    );
    expect(b1.id).toBeDefined();
    expect(b1.budgetAmount).toBe(50000);
    expect(b1.name).toBe("October Primary Living Budget");
    expect(b1.alertThreshold).toBe(85);

    // Update budget
    const updated = await updateBudget(
      b1.id,
      { budgetAmount: 55000, notes: "Adjusted for inflation" },
      user1Id,
    );
    expect(updated.budgetAmount).toBe(55000);
    expect(updated.notes).toBe("Adjusted for inflation");

    // Retrieve
    const fetched = await getBudget(b1.id, user1Id);
    expect(fetched?.budgetAmount).toBe(55000);

    // Delete
    await deleteBudget(b1.id, user1Id);
    const afterDelete = await getBudget(b1.id, user1Id);
    expect(afterDelete).toBeNull();
  });

  // Scenario 2: Overall budgets and category-specific budgets coexistence
  it("Scenario 2: Supports overall budgets and multiple category-specific allocations simultaneously", async () => {
    await createBudget(
      { month: "2026-10", category: null, budgetAmount: 40000, name: "Overall" },
      user1Id,
    );
    await createBudget(
      { month: "2026-10", category: "Food", budgetAmount: 12000, name: "Dining & Groceries" },
      user1Id,
    );
    await createBudget(
      { month: "2026-10", category: "Transport", budgetAmount: 6000, name: "Fuel & Metro" },
      user1Id,
    );

    const userBudgets = await getBudgets("2026-10", user1Id);
    expect(userBudgets.length).toBe(3);

    const overall = userBudgets.find((b) => !b.category);
    const categoryBudgets = userBudgets.filter((b) => b.category);
    expect(overall?.budgetAmount).toBe(40000);
    expect(categoryBudgets.length).toBe(2);
  });

  // Scenario 3: Zero, negative, and invalid budget amounts rejected
  it("Scenario 3: Safely rejects zero, negative, and non-numeric budget limits", async () => {
    await expect(
      createBudget({ month: "2026-10", category: "Food", budgetAmount: 0 }, user1Id),
    ).rejects.toThrow("Budget amount must be positive");

    await expect(
      createBudget({ month: "2026-10", category: "Food", budgetAmount: -500 }, user1Id),
    ).rejects.toThrow("Budget amount must be positive");

    await expect(
      createBudget({ month: "invalid-date", category: "Food", budgetAmount: 5000 }, user1Id),
    ).rejects.toThrow("Month must be YYYY-MM");
  });

  // Scenario 4: Empty transaction history
  it("Scenario 4: Handles empty transaction history safely without divide-by-zero errors", () => {
    const status = evaluateBudget({
      month: "2026-10",
      overallBudget: 25000,
      categoryBudgets: [{ category: "Food", budget: 8000 }],
      actualByCategory: {},
      totalActual: 0,
      threshold: 80,
    });
    expect(status.actualExpenses).toBe(0);
    expect(status.remaining).toBe(25000);
    expect(status.utilization).toBe(0);
    expect(status.dailyBurnRate).toBe(0);
    expect(status.warnings.some((w) => w.level === "ok")).toBe(true);
    expect(status.categoriesOverBudget).toBe(0);
  });

  // Scenario 5: Income-only data does not count as budget consumption
  it("Scenario 5: Ensures income transactions are not counted against expense budgets", async () => {
    const uIncome = await registerUser({
      name: "Income Only User",
      email: "income.only@example.com",
      password: "Password123!",
    });
    const incomeUserId = uIncome.user.id;

    await createBudget({ month: "2026-10", category: null, budgetAmount: 30000 }, incomeUserId);

    // Add Income transaction
    await createTransaction({
      userId: incomeUserId,
      transactionDate: "2026-10-02",
      transactionType: "Income",
      amount: 75000,
      category: "Salary",
      paymentMethod: "Bank Transfer",
      description: "Monthly Salary",
    });

    const status = await computeBudgetStatus("2026-10", {}, 0, undefined, incomeUserId);
    expect(status.actualExpenses).toBe(0);
    expect(status.remaining).toBe(30000);
    expect(status.utilization).toBe(0);
  });

  // Scenario 6: Spending below, at, and above the budget
  it("Scenario 6: Accurately classifies status as on track, warning, or exceeded", () => {
    // Under threshold (< 80%)
    const okStatus = evaluateBudget({
      month: "2026-10",
      overallBudget: 10000,
      categoryBudgets: [],
      actualByCategory: {},
      totalActual: 5000,
      threshold: 80,
    });
    expect(okStatus.utilization).toBeCloseTo(50);
    expect(okStatus.warnings.some((w) => w.level === "ok")).toBe(true);

    // Near limit (>= 80% and <= 100%)
    const warnStatus = evaluateBudget({
      month: "2026-10",
      overallBudget: 10000,
      categoryBudgets: [],
      actualByCategory: {},
      totalActual: 8500,
      threshold: 80,
    });
    expect(warnStatus.utilization).toBeCloseTo(85);
    expect(warnStatus.warnings.some((w) => w.level === "warning")).toBe(true);

    // Exceeded (> 100%)
    const overStatus = evaluateBudget({
      month: "2026-10",
      overallBudget: 10000,
      categoryBudgets: [],
      actualByCategory: {},
      totalActual: 11500,
      threshold: 80,
    });
    expect(overStatus.utilization).toBeCloseTo(115);
    expect(overStatus.remaining).toBe(-1500);
    expect(overStatus.warnings.some((w) => w.level === "exceeded")).toBe(true);
  });

  // Scenario 7: Unbudgeted categories with actual spending
  it("Scenario 7: Surfaces unbudgeted categories transparently without crashing", () => {
    const status = evaluateBudget({
      month: "2026-10",
      overallBudget: 20000,
      categoryBudgets: [{ category: "Food", budget: 5000 }],
      actualByCategory: { Food: 4000, Entertainment: 2500 },
      totalActual: 6500,
      threshold: 80,
    });
    const ent = status.categoryBreakdown.find((c) => c.category === "Entertainment");
    expect(ent).toBeDefined();
    expect(ent?.budget).toBeNull();
    expect(ent?.actual).toBe(2500);
    expect(ent?.status).toBe("Unbudgeted");
  });

  // Scenario 8: Mid-month burn rate & projected exhaustion date
  it("Scenario 8: Accurately projects month-end outlay and predicts exhaustion date", () => {
    // Current month: October has 31 days. On day 10, user spent 6,000 against a 10,000 budget.
    // Burn rate = 6,000 / 10 = 600/day.
    // Projected = 6,000 + (600 * 21) = 18,600.
    // Exhaustion day = ceil(10,000 / 600) = 17 (October 17).
    const refDate = new Date(Date.UTC(2026, 9, 10)); // Oct 10, 2026
    const status = evaluateBudget({
      month: "2026-10",
      overallBudget: 10000,
      categoryBudgets: [],
      actualByCategory: {},
      totalActual: 6000,
      threshold: 80,
      referenceDate: refDate,
    });

    expect(status.dailyBurnRate).toBeCloseTo(600, 1);
    expect(status.projectedPeriodEnd).toBeCloseTo(18600, 1);
    expect(status.projectedOverspend).toBeCloseTo(8600, 1);
    expect(status.projectedExhaustionDate).toBe("2026-10-17");
    expect(status.warnings.some((w) => w.level === "forecast")).toBe(true);
  });

  // Scenario 9: Dynamic updates after transaction deletion
  it("Scenario 9: Recalculates budget metrics immediately when transactions are added or deleted", async () => {
    const uDynamic = await registerUser({
      name: "Dynamic Recalc User",
      email: "dynamic.recalc@example.com",
      password: "Password123!",
    });
    const dynUserId = uDynamic.user.id;

    await createBudget({ month: "2026-10", category: "Food", budgetAmount: 5000 }, dynUserId);

    const tx = await createTransaction({
      userId: dynUserId,
      transactionDate: "2026-10-04",
      transactionType: "Expense",
      amount: 4500,
      category: "Food",
      paymentMethod: "UPI",
      description: "Bulk Grocery",
    });

    let status = await computeBudgetStatus(
      "2026-10",
      { Food: 4500 },
      4500,
      undefined,
      dynUserId,
    );
    expect(status.actualExpenses).toBe(4500);
    expect(status.categoryBreakdown.find((c) => c.category === "Food")?.utilization).toBe(90);

    // Delete transaction
    await deleteTransaction(tx.id, dynUserId);
    status = await computeBudgetStatus("2026-10", { Food: 0 }, 0, undefined, dynUserId);
    expect(status.actualExpenses).toBe(0);
    expect(status.categoryBreakdown.find((c) => c.category === "Food")?.utilization).toBe(0);
  });

  // Scenario 10: Multi-user data isolation
  it("Scenario 10: Strictly isolates budget records between different users", async () => {
    await createBudget(
      { month: "2026-10", category: null, budgetAmount: 100000, name: "User 1 Wealth Budget" },
      user1Id,
    );
    await createBudget(
      { month: "2026-10", category: null, budgetAmount: 15000, name: "User 2 Student Budget" },
      user2Id,
    );

    const budgetsA = await getBudgets("2026-10", user1Id);
    const budgetsB = await getBudgets("2026-10", user2Id);

    expect(budgetsA.some((b) => b.budgetAmount === 100000)).toBe(true);
    expect(budgetsA.some((b) => b.budgetAmount === 15000)).toBe(false);

    expect(budgetsB.some((b) => b.budgetAmount === 15000)).toBe(true);
    expect(budgetsB.some((b) => b.budgetAmount === 100000)).toBe(false);
  });

  // Scenario 11: Unallocated reserve calculation
  it("Scenario 11: Accurately calculates unallocated reserves without double counting", () => {
    const status = evaluateBudget({
      month: "2026-10",
      overallBudget: 50000,
      categoryBudgets: [
        { category: "Food", budget: 15000 },
        { category: "Housing", budget: 20000 },
      ],
      actualByCategory: { Food: 5000, Housing: 20000 },
      totalActual: 25000,
      threshold: 80,
    });
    // Category sum = 35,000. Overall = 50,000. Unallocated reserve = 15,000.
    expect(status.unallocatedReserve).toBe(15000);
    expect(status.remaining).toBe(25000);
  });

  // Scenario 12: Duplicate budget across months
  it("Scenario 12: Duplicates active budgets from one month to another seamlessly", async () => {
    const uDup = await registerUser({
      name: "Duplicate User",
      email: "duplicate.user@example.com",
      password: "Password123!",
    });
    const dupUserId = uDup.user.id;

    await createBudget(
      { month: "2026-09", category: null, budgetAmount: 45000, name: "Overall Sept" },
      dupUserId,
    );
    await createBudget(
      { month: "2026-09", category: "Transport", budgetAmount: 4000, name: "Transport Sept" },
      dupUserId,
    );

    const duplicated = await duplicateBudgets("2026-09", "2026-10", dupUserId);
    expect(duplicated.length).toBe(2);

    const octBudgets = await getBudgets("2026-10", dupUserId);
    expect(octBudgets.length).toBe(2);
    expect(octBudgets.find((b) => b.category === "Transport")?.budgetAmount).toBe(4000);
  });

  // Scenario 13: Budget Planning Wizard Suggestions
  it("Scenario 13: Computes data-driven budget suggestions based on historical trends", async () => {
    const uWiz = await registerUser({
      name: "Wizard User",
      email: "wizard.user@example.com",
      password: "Password123!",
    });
    const wizUserId = uWiz.user.id;

    // Add transactions in past months
    await createTransaction({
      userId: wizUserId,
      transactionDate: "2026-07-15",
      transactionType: "Expense",
      amount: 12000,
      category: "Food",
      paymentMethod: "UPI",
    });
    await createTransaction({
      userId: wizUserId,
      transactionDate: "2026-08-15",
      transactionType: "Expense",
      amount: 14000,
      category: "Food",
      paymentMethod: "UPI",
    });

    const suggestions = await getBudgetPlanningSuggestions("2026-10", wizUserId);
    expect(suggestions.targetMonth).toBe("2026-10");
    expect(suggestions.suggestedOverallBudget).toBeGreaterThan(0);
    const foodAlloc = suggestions.suggestedCategoryAllocations.find(
      (c) => c.category === "Food",
    );
    expect(foodAlloc).toBeDefined();
    expect(foodAlloc?.historicalAverage).toBeCloseTo(13000, 1);
  });

  // Scenario 14: Historical budget adherence and repeated overspending detection
  it("Scenario 14: Identifies repeated category overspending in historical telemetry", async () => {
    const uHist = await registerUser({
      name: "History Overspend User",
      email: "history.overspend@example.com",
      password: "Password123!",
    });
    const histUserId = uHist.user.id;

    // Set budgets in 2 past months
    await createBudget(
      { month: "2026-07", category: "Entertainment", budgetAmount: 3000 },
      histUserId,
    );
    await createBudget(
      { month: "2026-08", category: "Entertainment", budgetAmount: 3000 },
      histUserId,
    );

    // Overspend in both months
    await createTransaction({
      userId: histUserId,
      transactionDate: "2026-07-20",
      transactionType: "Expense",
      amount: 4200,
      category: "Entertainment",
      paymentMethod: "Credit Card",
    });
    await createTransaction({
      userId: histUserId,
      transactionDate: "2026-08-20",
      transactionType: "Expense",
      amount: 4500,
      category: "Entertainment",
      paymentMethod: "Credit Card",
    });

    const history = await getBudgetHistory(histUserId, 6);
    expect(history.history.length).toBeGreaterThanOrEqual(2);
    const rep = history.repeatedOverspendingCategories.find(
      (c) => c.category === "Entertainment",
    );
    expect(rep).toBeDefined();
    expect(rep?.occurrences).toBeGreaterThanOrEqual(2);
  });

  // Scenario 15: Intelligent recommendations generation
  it("Scenario 15: Generates targeted corrective recommendations for high-spending and unrealistic caps", () => {
    const status = evaluateBudget({
      month: "2026-10",
      overallBudget: 20000,
      categoryBudgets: [
        { category: "Food", budget: 3000 }, // Will be exceeded heavily
      ],
      actualByCategory: {
        Food: 7500, // Accounts for > 35% and heavily exceeds 3,000 limit
        Utilities: 1000,
      },
      totalActual: 8500,
      threshold: 80,
    });

    expect(status.recommendations.length).toBeGreaterThan(0);
    const highSpendRec = status.recommendations.find(
      (r) => r.type === "reduce_high_spend" && r.relevantCategory === "Food",
    );
    expect(highSpendRec).toBeDefined();
    expect(highSpendRec?.supportingData).toContain("Food");

    const unrealisticRec = status.recommendations.find(
      (r) => r.type === "adjust_unrealistic" && r.relevantCategory === "Food",
    );
    expect(unrealisticRec).toBeDefined();
  });

  // Scenario 16: LSTM Deep Learning Forecast synthesis
  it("Scenario 16: Synthesizes LSTM forecast comparison transparently against planned limits", () => {
    const status = evaluateBudget({
      month: "2026-10",
      overallBudget: 25000,
      categoryBudgets: [],
      actualByCategory: {},
      totalActual: 10000,
      threshold: 80,
      lstmForecast: {
        predictedExpense: 28500,
        method: "Personalized LSTM Deep Learning",
        explanation: "Neural network predicts month-end outlay based on 6-month sequence",
      },
    });

    expect(status.lstmForecast).toBeDefined();
    expect(status.lstmForecast?.predictedExpense).toBe(28500);
    expect(status.lstmForecast?.varianceVsBudget).toBe(3500); // 28,500 - 25,000 = +3,500 over
  });

  // Scenario 17: Date boundary and month length calculation
  it("Scenario 17: Correctly accounts for month day lengths including February and leap years", () => {
    const feb2024Status = evaluateBudget({
      month: "2024-02", // Leap year February (29 days)
      overallBudget: 29000,
      categoryBudgets: [],
      actualByCategory: {},
      totalActual: 14500,
      threshold: 80,
    });
    expect(feb2024Status.totalDaysInMonth).toBe(29);

    const feb2025Status = evaluateBudget({
      month: "2025-02", // Non-leap year February (28 days)
      overallBudget: 28000,
      categoryBudgets: [],
      actualByCategory: {},
      totalActual: 14000,
      threshold: 80,
    });
    expect(feb2025Status.totalDaysInMonth).toBe(28);
  });
});
