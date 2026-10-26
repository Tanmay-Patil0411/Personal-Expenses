import { describe, it, expect, beforeEach } from "vitest";
import { resetTestSchema } from "@/db/test-utils";
import { registerUser } from "@/lib/auth";
import {
  saveTrainingDataset,
  getActiveTrainingDataset,
  getTrainingRecords,
} from "@/lib/trainingService";
import {
  createTransaction,
  getTransactions,
  countTransactions,
  updateTransaction,
  deleteTransaction,
} from "@/lib/transactionService";
import { gatherDashboard } from "@/lib/aggregate";
import { getPersonalizedForecast } from "@/ml/pipeline";
import { nextMonth, normalizeMonthKey } from "@/lib/config";
import { db } from "@/db";
import { trainingDatasets, trainingRecords, transactions, predictions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

describe("Training Dataset Separation & Personal Financial Isolation", () => {
  beforeEach(async () => {
    await resetTestSchema();
  });

  it("strictly stores external/Kaggle datasets in training tables and leaves user transactions untouched", async () => {
    const user = await registerUser({
      name: "Tanmay",
      email: "tanmay@example.com",
      password: "Password123!",
    });

    // Mock 15 months of Kaggle dataset rows
    const mockKaggleRows = [];
    for (let month = 1; month <= 15; month++) {
      const monthStr = month < 10 ? `0${month}` : `${month}`;
      const year = month <= 12 ? "2021" : "2022";
      const actualMonth = month <= 12 ? monthStr : `0${month - 12}`;
      mockKaggleRows.push({
        transactionDate: `${year}-${actualMonth}-15`,
        transactionType: "Expense" as const,
        amount: 5000 + month * 100,
        category: "Food",
        paymentMethod: "Cash",
        description: `Kaggle Grocery Item #${month}`,
        externalTransactionId: `kaggle_${month}`,
      });
    }

    // Save strictly to training storage
    const saved = await saveTrainingDataset({
      name: "Daily Household Transactions (Kaggle)",
      source: "kaggle",
      filename: "Daily Household Transactions.csv",
      validRows: mockKaggleRows,
      userId: user.user.id,
    });

    expect(saved.count).toBe(15);
    expect(saved.dataset.rowCount).toBe(15);
    expect(saved.dataset.monthsCount).toBe(15);

    // Verify training_records has the 15 records
    const records = await getTrainingRecords(user.user.id, saved.dataset.id);
    expect(records).toHaveLength(15);

    // CRITICAL: Verify personal transactions table is COMPLETELY EMPTY
    const personalCount = await countTransactions(user.user.id);
    expect(personalCount).toBe(0);

    const personalList = await getTransactions({ userId: user.user.id });
    expect(personalList).toHaveLength(0);

    // CRITICAL: Dashboard displays zero personal income/expenses, not Kaggle numbers
    const dashboard = await gatherDashboard({}, user.user.id);
    expect(dashboard.kpis.totalExpenses).toBe(0);
    expect(dashboard.kpis.totalIncome).toBe(0);
    expect(dashboard.kpis.netCashFlow).toBe(0);
    expect(dashboard.recent).toHaveLength(0);
    expect(dashboard.charts.monthlyExpense).toHaveLength(0);
  });

  it("adding personal transactions updates dashboard without altering training dataset", async () => {
    const user = await registerUser({
      name: "Tanmay",
      email: "tanmay2@example.com",
      password: "Password123!",
    });

    // 1. Upload external training records
    const mockKaggleRows = [
      {
        transactionDate: "2020-01-10",
        transactionType: "Expense" as const,
        amount: 8000,
        category: "Groceries",
        paymentMethod: "Card",
        description: "Kaggle External Expense",
        externalTransactionId: "kaggle_ext_1",
      },
    ];

    const saved = await saveTrainingDataset({
      name: "Kaggle Set",
      source: "kaggle",
      validRows: mockKaggleRows,
      userId: user.user.id,
    });

    // 2. Add a personal expense of 250 for user
    const personalTxn = await createTransaction(
      {
        transactionDate: "2026-03-15",
        transactionType: "Expense",
        amount: 250,
        category: "Food",
        paymentMethod: "UPI",
        description: "My Personal Dinner",
      },
      user.user.id,
    );

    // Check personal transactions
    const userTxns = await getTransactions({ userId: user.user.id });
    expect(userTxns).toHaveLength(1);
    expect(userTxns[0].id).toBe(personalTxn.id);
    expect(userTxns[0].description).toBe("My Personal Dinner");
    expect(userTxns[0].amount).toBe(250);

    // Dashboard only includes the 250 personal transaction
    const dashboard = await gatherDashboard({}, user.user.id);
    expect(dashboard.kpis.totalExpenses).toBe(250);
    expect(dashboard.recent).toHaveLength(1);
    expect(dashboard.recent[0].description).toBe("My Personal Dinner");

    // Training dataset is unchanged (still 1 external row, not 2)
    const trainingRecs = await getTrainingRecords(user.user.id, saved.dataset.id);
    expect(trainingRecs).toHaveLength(1);
    expect(trainingRecs[0].description).toBe("Kaggle External Expense");
  });

  it("ensures User A cannot view or alter User B's personal transactions or dashboard", async () => {
    const userA = await registerUser({
      name: "User A",
      email: "usera_iso@example.com",
      password: "Password123!",
    });

    const userB = await registerUser({
      name: "User B",
      email: "userb_iso@example.com",
      password: "Password123!",
    });

    // User A records personal transaction of 1500
    await createTransaction(
      {
        transactionDate: "2026-03-20",
        transactionType: "Expense",
        amount: 1500,
        category: "Housing",
        paymentMethod: "Bank Transfer",
        description: "User A Rent",
      },
      userA.user.id,
    );

    // User B records personal transaction of 400
    await createTransaction(
      {
        transactionDate: "2026-03-21",
        transactionType: "Expense",
        amount: 400,
        category: "Entertainment",
        paymentMethod: "Credit Card",
        description: "User B Movie",
      },
      userB.user.id,
    );

    // Dashboard A sees 1500, NOT User B's 400
    const dashA = await gatherDashboard({}, userA.user.id);
    expect(dashA.kpis.totalExpenses).toBe(1500);
    expect(dashA.recent).toHaveLength(1);
    expect(dashA.recent[0].description).toBe("User A Rent");

    // Dashboard B sees 400, NOT User A's 1500
    const dashB = await gatherDashboard({}, userB.user.id);
    expect(dashB.kpis.totalExpenses).toBe(400);
    expect(dashB.recent).toHaveLength(1);
    expect(dashB.recent[0].description).toBe("User B Movie");
  });

  it("computes personal baseline forecast for user with 1-5 months of data and targets upcoming month", async () => {
    const user = await registerUser({
      name: "Baseline User",
      email: "baseline_user@example.com",
      password: "Password123!",
    });

    // Add 2 months of personal expenses: Jan 2026 (5000) and Feb 2026 (7000)
    await createTransaction(
      {
        transactionDate: "2026-01-15",
        transactionType: "Expense",
        amount: 5000,
        category: "Food",
        paymentMethod: "Cash",
        description: "Jan Groceries",
      },
      user.user.id,
    );

    await createTransaction(
      {
        transactionDate: "2026-02-15",
        transactionType: "Expense",
        amount: 7000,
        category: "Housing",
        paymentMethod: "UPI",
        description: "Feb Maintenance",
      },
      user.user.id,
    );

    const forecast = await getPersonalizedForecast(user.user.id);
    const expectedUpcomingMonth = nextMonth(normalizeMonthKey(new Date()));

    expect(forecast.targetMonth).toBe(expectedUpcomingMonth);
    expect(forecast.status).toBe("baseline");
    // 2-month weighted moving average (40% first month, 60% second month): 5000*0.4 + 7000*0.6 = 6200
    expect(forecast.predictedExpense).toBe(6200);
    expect(forecast.monthsCount).toBe(2);
    expect(forecast.requiredMonths).toBe(6);

    // Dashboard also receives this personalized forecast
    const dashboard = await gatherDashboard({}, user.user.id);
    expect(dashboard.kpis.predictedNextMonth).toBe(6200);
    expect(dashboard.forecast.targetMonth).toBe(expectedUpcomingMonth);
  });

  it("deleting or updating a transaction invalidates predictions and updates forecast", async () => {
    const user = await registerUser({
      name: "Invalidation User",
      email: "inval_user@example.com",
      password: "Password123!",
    });

    const txn = await createTransaction(
      {
        transactionDate: "2026-01-15",
        transactionType: "Expense",
        amount: 10000,
        category: "Shopping",
        paymentMethod: "Credit Card",
        description: "Laptop",
      },
      user.user.id,
    );

    let forecast = await getPersonalizedForecast(user.user.id);
    expect(forecast.predictedExpense).toBe(10000);

    // Update transaction amount to 20000
    await updateTransaction(txn.id, { amount: 20000 }, user.user.id);

    forecast = await getPersonalizedForecast(user.user.id);
    expect(forecast.predictedExpense).toBe(20000);

    // Delete transaction
    await deleteTransaction(txn.id, user.user.id);

    forecast = await getPersonalizedForecast(user.user.id);
    expect(forecast.predictedExpense).toBeNull();
    expect(forecast.status).toBe("no_data");
  });
});
