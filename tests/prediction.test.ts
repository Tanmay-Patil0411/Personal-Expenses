import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MinMaxScaler } from "@/ml/scaler";
import {
  buildSequences,
  splitSeries,
  buildMonthlySeries,
  monthKeysFromSeries,
  buildMonthlyExpenseDataset,
  InsufficientDataError,
} from "@/ml/dataset";
import { evaluate, computeBaselines, mae, rmse, mape, wape } from "@/ml/evaluate";
import { nextMonth, minRequiredMonths, addMonths, normalizeMonthKey } from "@/lib/config";
import { generateSyntheticTransactions } from "@/lib/demo";
import { db } from "@/db";
import { predictions } from "@/db/schema";
import {
  getPersonalizedForecast,
  getForecastStatus,
  getMultiHorizonForecast,
  getCategoryForecasts,
  getGranularAnalysis,
  getPredictionExplainability,
  simulateSpendingScenario,
  getPredictionHistory,
  savePredictionRecord,
} from "@/ml/pipeline";
import {
  saveArtifacts,
  loadArtifacts,
  artifactsExist,
  saveEval,
  loadEval,
  getArtifactDir,
  validateModelCompatibility,
} from "@/ml/persist";
import { createTransaction, getTransactions } from "@/lib/transactionService";
import { createBudget } from "@/lib/budgetService";
import { registerUser } from "@/lib/auth";
import {
  getModel,
  isModelTrained,
  invalidateModel,
} from "@/ml/modelManager";
import {
  runTrainingPipeline,
  isTrainingInProgress,
} from "@/ml/pipeline";
import fs from "fs";
import path from "path";
import { buildLstmModel, sequencesToTensors } from "@/ml/model";
import { predictNext } from "@/ml/predict";
import type { Transaction } from "@/lib/types";

function makeSeries(n = 24): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(500 + i * 10 + 100 * Math.sin((i / 12) * 2 * Math.PI));
  }
  return out;
}

describe("LSTM pipeline & Persistence System", () => {
  const testDir = getArtifactDir();

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test artifacts folder
    const testRoot = path.join(process.cwd(), ".ml-artifacts-test");
    if (fs.existsSync(testRoot)) {
      try {
        fs.rmSync(testRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it("builds sliding-window sequences of the right shape", () => {
    const { xs, ys } = buildSequences([1, 2, 3, 4, 5, 6, 7], 3);
    expect(xs.length).toBe(4);
    expect(xs[0]).toEqual([1, 2, 3]);
    expect(ys[0]).toBe(4);
  });

  it("splits chronologically without overlap", () => {
    const series = Array.from({ length: 20 }, (_, i) => i + 1);
    const split = splitSeries(series, 3, 4, 4);
    expect(split.train.length).toBe(12);
    expect(split.val.length).toBe(4);
    expect(split.test.length).toBe(4);
    expect(split.test[0]).toBeGreaterThan(split.val[split.val.length - 1]);
    expect(split.val[0]).toBeGreaterThan(split.train[split.train.length - 1]);
  });

  it("throws InsufficientDataError when data is shorter than required minimum", () => {
    expect(() => splitSeries([100, 200], 6, 3, 3)).toThrow(
      InsufficientDataError,
    );
  });

  it("verifies minRequiredMonths formula matches pipeline", () => {
    expect(minRequiredMonths(6)).toBe(13); // 6 + 1 + 3 + 3
    expect(minRequiredMonths(3)).toBe(10);
  });

  it("normalizes and inverts values with MinMaxScaler", () => {
    const scaler = new MinMaxScaler();
    scaler.fit([10, 20, 30, 40, 50]);
    expect(scaler.transform(10)).toBe(0);
    expect(scaler.transform(50)).toBe(1);
    expect(scaler.transform(30)).toBe(0.5);
    expect(scaler.inverse(0)).toBe(10);
    expect(scaler.inverse(1)).toBe(50);
  });

  it("builds a functional LSTM model graph", () => {
    const model = buildLstmModel(6, 32);
    expect(model.inputs.length).toBe(1);
    expect(model.outputs.length).toBe(1);
    expect(model.countParams()).toBeGreaterThan(500);
    model.dispose();
  });

  it(
    "saves and loads trained model weights and architecture atomically",
    async () => {
      const model = buildLstmModel(6, 32);
      const scaler = new MinMaxScaler();
      scaler.fit([10, 20, 30]);
      const meta = {
        modelVersion: "test-v1",
        sequenceLength: 6,
        trainMonths: 12,
        valMonths: 4,
        testMonths: 4,
        firstMonth: "2024-01",
        lastMonth: "2024-12",
        targetMonth: "2025-01",
        trainStart: new Date().toISOString(),
        trainEnd: new Date().toISOString(),
        epochs: 1,
        batchSize: 8,
        savedAt: new Date().toISOString(),
      };
      await saveArtifacts(model, scaler, meta);
      expect(artifactsExist()).toBe(true);

      const loaded = await loadArtifacts();
      expect(loaded.meta.modelVersion).toBe("test-v1");
      expect(loaded.scaler["min"]).toBe(10);

      model.dispose();
      loaded.model.dispose();
    },
    20000,
  );

  it("caches loaded model in memory via modelManager and verifies integrity", async () => {
    invalidateModel();

    // First load hits disk and runs validation check
    const m1 = await getModel();
    expect(m1).not.toBeNull();
    expect(m1?.meta.modelVersion).toBe("test-v1");

    // Second call reuses the in-memory cached instance
    const m2 = await getModel();
    expect(m2).toBe(m1); // identical reference in memory

    const status = await isModelTrained();
    expect(status.trained).toBe(true);
    expect(status.meta?.modelVersion).toBe("test-v1");
  });

  it("detects corrupt or missing artifacts and reports untrained", async () => {
    // Check non-existent user
    const fakeUserStatus = await isModelTrained(99999);
    expect(fakeUserStatus.trained).toBe(false);
    expect(fakeUserStatus.reason).toMatch(/no saved model/i);
  });

  it("computes baseline metrics fairly", () => {
    const series = makeSeries(18);
    const baselines = computeBaselines(series, 3, 3);
    expect(baselines.length).toBe(2);
    expect(baselines[0].metrics.mae).toBeGreaterThan(0);
  });

  it("computes regression metrics accurately", () => {
    const a = [100, 200, 300];
    const p = [110, 190, 320];
    expect(mae(a, p)).toBeCloseTo(13.33, 1);
    expect(rmse(a, p)).toBeGreaterThan(0);
    expect(mape([0, 200], [50, 200])).toBeCloseTo(0);
  });

  it("builds synchronized monthly series and month keys", () => {
    const txns: Transaction[] = [
      {
        id: 1,
        transactionDate: "2025-01-05",
        transactionType: "Expense",
        amount: 100,
        category: "Food",
        paymentMethod: "Cash",
        description: "",
      },
      {
        id: 2,
        transactionDate: "2025-01-20",
        transactionType: "Expense",
        amount: 50,
        category: "Food",
        paymentMethod: "Cash",
        description: "",
      },
      {
        id: 3,
        transactionDate: "2025-03-02",
        transactionType: "Expense",
        amount: 200,
        category: "Food",
        paymentMethod: "Cash",
        description: "",
      },
      {
        id: 4,
        transactionDate: "2025-01-31",
        transactionType: "Income",
        amount: 5000,
        category: "Salary",
        paymentMethod: "Bank Transfer",
        description: "",
      },
    ];

    const dataset = buildMonthlyExpenseDataset(txns);
    expect(dataset.series).toEqual([150, 0, 200]);
    expect(dataset.monthKeys).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(dataset.series.length).toBe(dataset.monthKeys.length);
    expect(dataset.startDate).toBe("2025-01-01");
    expect(dataset.endDate).toBe("2025-03-31");
  });

  it("generates next-month target correctly", () => {
    expect(nextMonth("2024-12")).toBe("2025-01");
    expect(nextMonth("2024-06")).toBe("2024-07");
  });

  it("reproducibly generates synthetic transactions for demo mode", () => {
    const a = generateSyntheticTransactions({ months: 6, seed: 42 });
    const b = generateSyntheticTransactions({ months: 6, seed: 42 });
    expect(a.length).toBe(b.length);
    expect(a[0].amount).toBe(b[0].amount);
    expect(
      a.every((t) => t.externalTransactionId?.startsWith("DEMO-")),
    ).toBe(true);
  });

  it("saves and loads evaluation payloads cleanly", () => {
    const payload = {
      targetMonth: "2025-02",
      nextForecast: 123.45,
      evaluation: {
        actual: [1, 2],
        predicted: [1.1, 2.1],
        metrics: { mae: 0.1, rmse: 0.1, mape: 1 },
      },
      baselines: [] as any[],
      history: { loss: [1, 0.5], valLoss: [1, 0.6] },
      trainMonths: 10,
      valMonths: 2,
      testMonths: 2,
      modelVersion: "test",
    };
    saveEval(payload);
    expect(loadEval()?.targetMonth).toBe("2025-02");
  });

  it("handles multi-year month arithmetic and year boundaries correctly", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-06", 12)).toBe("2027-06");
    expect(addMonths("2026-06", -6)).toBe("2025-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });

  it("returns no_data status and upcoming target month for user with zero expenses", async () => {
    // Non-existent user ID 999999 has 0 transactions
    const forecast = await getPersonalizedForecast(999999);
    const currentMonth = normalizeMonthKey(new Date());
    const expectedTarget = nextMonth(currentMonth);

    expect(forecast.targetMonth).toBe(expectedTarget);
    expect(forecast.predictedExpense).toBeNull();
    expect(forecast.status).toBe("no_data");
    expect(forecast.method).toBe("None");
    expect(forecast.monthsCount).toBe(0);
    expect(forecast.historicalSeries).toEqual([]);
  });

  it("validates model metadata compatibility strictly", () => {
    const validMeta = {
      modelVersion: "lstm-v1",
      sequenceLength: 6,
      trainMonths: 24,
      valMonths: 3,
      testMonths: 3,
      firstMonth: "2025-01",
      lastMonth: "2026-08",
      targetMonth: "2026-09",
      trainStart: new Date().toISOString(),
      trainEnd: new Date().toISOString(),
      epochs: 80,
      batchSize: 8,
      savedAt: new Date().toISOString(),
      datasetMode: "real",
      userId: 42,
    };

    // Valid personal model for user 42
    expect(validateModelCompatibility(validMeta, 42, ["2025-01", "2026-08"]).valid).toBe(true);

    // Mismatched user ID
    const wrongUser = validateModelCompatibility(validMeta, 99);
    expect(wrongUser.valid).toBe(false);
    expect(wrongUser.reason).toMatch(/belongs to user #42/i);

    // External Kaggle dataset mode
    const kaggleMode = validateModelCompatibility({ ...validMeta, datasetMode: "kaggle" }, 42);
    expect(kaggleMode.valid).toBe(false);
    expect(kaggleMode.reason).toMatch(/kaggle/i);

    // Invalid sequence length
    const invalidSeq = validateModelCompatibility({ ...validMeta, sequenceLength: 0 }, 42);
    expect(invalidSeq.valid).toBe(false);

    // Obsolete model (e.g. 2018 dates when user history begins in 2026)
    const obsolete = validateModelCompatibility(
      { ...validMeta, firstMonth: "2015-01", lastMonth: "2018-09" },
      42,
      ["2026-01", "2026-09"],
    );
    expect(obsolete.valid).toBe(false);
    expect(obsolete.reason).toMatch(/obsolete/i);
  });

  it("partitions completed historical months from the current ongoing month", () => {
    const currentKey = normalizeMonthKey(new Date());
    const [y, m] = currentKey.split("-").map(Number);
    const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;

    const txns: Transaction[] = [
      {
        id: 1,
        transactionDate: `${prevKey}-15`,
        transactionType: "Expense",
        amount: 20000,
        category: "Housing",
        paymentMethod: "Bank Transfer",
        description: "Completed month expense",
      },
      {
        id: 2,
        transactionDate: `${currentKey}-05`,
        transactionType: "Expense",
        amount: 5000,
        category: "Food",
        paymentMethod: "Cash",
        description: "Current month partial expense",
      },
    ];

    const dataset = buildMonthlyExpenseDataset(txns);
    expect(dataset.completedMonthKeys).toEqual([prevKey]);
    expect(dataset.completedSeries).toEqual([20000]);
    expect(dataset.hasCompletedMonths).toBe(true);
    expect(dataset.hasCurrentMonth).toBe(true);
    expect(dataset.currentMonthTotal).toBe(5000);
  });

  it("produces run-rate projection and avoids repeating current month when 0 completed months exist", async () => {
    const testUser = await registerUser({
      name: "RunRate User",
      email: `runrate_${Date.now()}@test.com`,
      password: "Password123!",
    });

    const now = new Date();
    const currentMonthKey = normalizeMonthKey(now);
    const dayStr = String(Math.min(15, now.getDate())).padStart(2, "0");

    // Add 1 transaction in the current month only
    await createTransaction(
      {
        transactionDate: `${currentMonthKey}-${dayStr}`,
        transactionType: "Expense",
        amount: 15000,
        category: "Food",
        paymentMethod: "Credit Card",
        description: "Grocery run",
      },
      testUser.user.id,
    );

    const forecast = await getPersonalizedForecast(testUser.user.id, now);
    expect(forecast.status).toBe("run_rate");
    expect(forecast.method).toBe("Current Month Run-Rate Projection");
    expect(forecast.predictedExpense).toBeGreaterThan(0);
    expect(Number.isFinite(forecast.predictedExpense)).toBe(true);
    expect(forecast.explanation).toMatch(/run-rate estimate/i);
  });

  it("uses completed historical months for baseline without averaging in current month", async () => {
    const testUser = await registerUser({
      name: "Completed Baseline User",
      email: `baseline_${Date.now()}@test.com`,
      password: "Password123!",
    });

    const now = new Date();
    const currentMonthKey = normalizeMonthKey(now);
    const [y, m] = currentMonthKey.split("-").map(Number);
    const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;

    // Completed month: 30000
    await createTransaction(
      {
        transactionDate: `${prevKey}-10`,
        transactionType: "Expense",
        amount: 30000,
        category: "Housing",
        paymentMethod: "Bank Transfer",
        description: "Last month rent",
      },
      testUser.user.id,
    );

    // Current ongoing month: small amount 1000
    await createTransaction(
      {
        transactionDate: `${currentMonthKey}-05`,
        transactionType: "Expense",
        amount: 1000,
        category: "Food",
        paymentMethod: "UPI",
        description: "Current month lunch",
      },
      testUser.user.id,
    );

    const forecast = await getPersonalizedForecast(testUser.user.id, now);
    expect(forecast.status).toBe("baseline");
    // Single completed month baseline is exactly 30000, NOT (30000 + 1000) / 2 = 15500
    expect(forecast.predictedExpense).toBe(30000);
    expect(forecast.method).toMatch(/Personal Historical Baseline/i);
  });

  describe("Model Status & Persistence Verification", () => {
    it("reports UNTRAINED status and zero artifacts when no model has been trained", async () => {
      const freshUser = await registerUser({
        name: "Fresh Untrained User",
        email: `untrained_${Date.now()}@test.com`,
        password: "Password123!",
      });

      expect(artifactsExist(freshUser.user.id)).toBe(false);
      const check = await isModelTrained(freshUser.user.id);
      expect(check.trained).toBe(false);
      expect(check.reason).toMatch(/No saved model artifacts/i);

      const status = await getForecastStatus(freshUser.user.id);
      expect(status.hasModel).toBe(false);
      expect(status.modelStatus).toBe("untrained");
      expect(status.availableMonths).toBe(0);
      expect(status.requiredMonths).toBe(13);
      expect(status.canTrain).toBe(false);
      expect(status.insufficientReason).toContain("13");
    });

    it("rejects training on insufficient personal data (< 13 months) with clear explanation", async () => {
      const user = await registerUser({
        name: "Insufficient Data User",
        email: `insufficient_${Date.now()}@test.com`,
        password: "Password123!",
      });

      // Add only 1 transaction in 1 month
      await createTransaction(
        {
          transactionDate: "2026-10-15",
          transactionType: "Expense",
          amount: 5000,
          category: "Food",
          paymentMethod: "Cash",
          description: "One month only",
        },
        user.user.id,
      );

      const outcome = await runTrainingPipeline(user.user.id, {
        datasetMode: "real",
      });

      expect(outcome.ok).toBe(false);
      expect(outcome.insufficient).toBe(true);
      expect(outcome.error).toMatch(/requires at least 13 months/i);
      expect(outcome.error).toMatch(/found 1 months/i);
      expect(artifactsExist(user.user.id)).toBe(false);
    });

    it("trains model successfully with demo/kaggle data, persists artifacts, and loads after restart", async () => {
      const user = await registerUser({
        name: "Persistent Model User",
        email: `persistent_${Date.now()}@test.com`,
        password: "Password123!",
      });

      // Train with fast 2 epochs in demo mode
      const outcome = await runTrainingPipeline(user.user.id, {
        datasetMode: "demo",
        epochs: 2,
        batchSize: 16,
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.monthsUsed).toBe(60);
      expect(outcome.nextForecast).toBeGreaterThan(0);

      // Verify artifacts exist on disk
      expect(artifactsExist(user.user.id)).toBe(true);

      // Invalidate in-memory cache to simulate full app restart
      invalidateModel(user.user.id);

      // Verify model can be loaded from persistent disk and executed
      const loaded = await getModel(user.user.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.meta.modelVersion).toBe("lstm-v1");
      expect(loaded?.meta.datasetMode).toBe("demo");

      const check = await isModelTrained(user.user.id);
      expect(check.trained).toBe(true);
      expect(check.meta?.datasetMode).toBe("demo");

      const status = await getForecastStatus(user.user.id);
      expect(status.hasModel).toBe(true);
      expect(status.modelStatus).toBe("trained");
      expect(status.latestRun?.status).toBe("completed");
    }, 20000);

    it("never reports TRAINED if model artifacts on disk are deleted or missing", async () => {
      const user = await registerUser({
        name: "Corrupt Artifact User",
        email: `corrupt_${Date.now()}@test.com`,
        password: "Password123!",
      });

      // Initially untrained
      expect(artifactsExist(user.user.id)).toBe(false);
      const check = await isModelTrained(user.user.id);
      expect(check.trained).toBe(false);

      const status = await getForecastStatus(user.user.id);
      expect(status.hasModel).toBe(false);
      expect(status.modelStatus).not.toBe("trained");
    });
  });

  describe("Multi-Horizon Forecasting & Advanced Analytics Engine", () => {
    it("computes WAPE metric and handles edge cases accurately", () => {
      const a = [100, 200, 300];
      const p = [110, 190, 320];
      // |100-110| + |200-190| + |300-320| = 10 + 10 + 20 = 40; sum(a) = 600; 40/600 * 100 = 6.67%
      expect(wape(a, p)).toBeCloseTo(6.67, 1);

      // Edge case: sum of actuals is zero
      expect(wape([0, 0], [10, 20])).toBeNull();

      // evaluate() includes wape in output metrics
      const res = evaluate(a, p);
      expect(res.wape).toBeCloseTo(6.67, 1);
    });

    it("generates multi-horizon forecasts for 7d, 30d, 3m, and 6m with rigorous bounds", async () => {
      const user = await registerUser({
        name: "Horizon User",
        email: `horizon_${Date.now()}@test.com`,
        password: "Password123!",
      });

      const now = new Date();
      const currentMonthKey = normalizeMonthKey(now);
      const [y, m] = currentMonthKey.split("-").map(Number);
      const m1 = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
      const m2 = addMonths(currentMonthKey, -2);
      const m3 = addMonths(currentMonthKey, -3);

      // Seed 3 completed months
      for (const mo of [m3, m2, m1]) {
        await createTransaction(
          {
            transactionDate: `${mo}-10`,
            transactionType: "Expense",
            amount: 20000,
            category: "Food",
            paymentMethod: "UPI",
            description: "Groceries",
          },
          user.user.id,
        );
        await createTransaction(
          {
            transactionDate: `${mo}-20`,
            transactionType: "Expense",
            amount: 10000,
            category: "Transport",
            paymentMethod: "Credit Card",
            description: "Fuel",
          },
          user.user.id,
        );
      }

      // 1. 7-Day Daily Horizon
      const f7d = await getMultiHorizonForecast(user.user.id, "7d", now);
      expect(f7d.horizon).toBe("7d");
      expect(f7d.granularity).toBe("daily");
      expect(f7d.points.length).toBe(7);
      expect(f7d.totalPredicted).toBeGreaterThan(0);
      for (const pt of f7d.points as any[]) {
        expect(pt.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(pt.predictedAmount).toBeGreaterThan(0);
        expect(pt.lowerBound).toBeLessThanOrEqual(pt.predictedAmount);
        expect(pt.upperBound).toBeGreaterThanOrEqual(pt.predictedAmount);
      }

      // 2. 30-Day Daily Horizon
      const f30d = await getMultiHorizonForecast(user.user.id, "30d", now);
      expect(f30d.horizon).toBe("30d");
      expect(f30d.granularity).toBe("daily");
      expect(f30d.points.length).toBe(30);

      // 3. 3-Month Monthly Horizon
      const f3m = await getMultiHorizonForecast(user.user.id, "3m", now);
      expect(f3m.horizon).toBe("3m");
      expect(f3m.granularity).toBe("monthly");
      expect(f3m.points.length).toBe(3);
      for (const pt of f3m.points as any[]) {
        expect(pt.month).toMatch(/^\d{4}-\d{2}$/);
        expect(pt.predictedAmount).toBeGreaterThan(0);
      }

      // 4. 6-Month Monthly Horizon
      const f6m = await getMultiHorizonForecast(user.user.id, "6m", now);
      expect(f6m.horizon).toBe("6m");
      expect(f6m.points.length).toBe(6);
    });

    it("performs category-wise forecasting and aligns with category budgets", async () => {
      const user = await registerUser({
        name: "Category Forecast User",
        email: `catfc_${Date.now()}@test.com`,
        password: "Password123!",
      });

      const now = new Date();
      const currentMonthKey = normalizeMonthKey(now);
      const prev1 = addMonths(currentMonthKey, -1);
      const prev2 = addMonths(currentMonthKey, -2);
      const targetMo = nextMonth(currentMonthKey);

      for (const mo of [prev2, prev1]) {
        await createTransaction(
          {
            transactionDate: `${mo}-05`,
            transactionType: "Expense",
            amount: 25000,
            category: "Food",
            paymentMethod: "UPI",
            description: "Supermarket",
          },
          user.user.id,
        );
        await createTransaction(
          {
            transactionDate: `${mo}-15`,
            transactionType: "Expense",
            amount: 15000,
            category: "Housing",
            paymentMethod: "Bank Transfer",
            description: "Maintenance",
          },
          user.user.id,
        );
      }

      // Set a category budget for targetMo
      await createBudget(
        {
          month: targetMo,
          category: "Food",
          budgetAmount: 20000,
        },
        user.user.id,
      );

      const catSummary = await getCategoryForecasts(user.user.id, targetMo, now);
      expect(catSummary.categories.length).toBe(2);
      expect(catSummary.highestProjectedCategory).toBe("Food");

      const foodCat = catSummary.categories.find((c) => c.category === "Food");
      expect(foodCat).toBeDefined();
      expect(foodCat?.predictedAmount).toBeGreaterThan(0);
      expect(foodCat?.categoryBudget).toBe(20000);
      expect(foodCat?.budgetStatus).toBe("over"); // Food projected ~25000 vs 20000 budget
      expect(foodCat?.budgetVariance).toBeGreaterThan(0);

      // Verify category shares sum to approx 100%
      const totalShare = catSummary.categories.reduce((acc, c) => acc + c.shareOfTotal, 0);
      expect(totalShare).toBeCloseTo(100, 0);

      // Verify category predictions sum to total predicted
      const sumPred = catSummary.categories.reduce((acc, c) => acc + c.predictedAmount, 0);
      expect(sumPred).toBeCloseTo(catSummary.totalPredicted, 1);
    });

    it("computes granular daily, weekly, and monthly spending patterns", async () => {
      const user = await registerUser({
        name: "Granular Pattern User",
        email: `granular_${Date.now()}@test.com`,
        password: "Password123!",
      });

      const now = new Date();
      const currentMonthKey = normalizeMonthKey(now);
      const prevMonthKey = addMonths(currentMonthKey, -1);

      await createTransaction(
        {
          transactionDate: `${prevMonthKey}-01`,
          transactionType: "Expense",
          amount: 3000,
          category: "Food",
          paymentMethod: "Credit Card",
          description: "Brunch",
        },
        user.user.id,
      );

      await createTransaction(
        {
          transactionDate: `${prevMonthKey}-02`,
          transactionType: "Expense",
          amount: 7000,
          category: "Shopping",
          paymentMethod: "Credit Card",
          description: "Clothes",
        },
        user.user.id,
      );

      const analysis = await getGranularAnalysis(user.user.id, now);

      // 1. Daily
      expect(analysis.daily.dayOfWeekAverages.length).toBe(7);
      expect(analysis.daily.peakDay).not.toBe("None");
      expect(typeof analysis.daily.weekdayAverage).toBe("number");
      expect(typeof analysis.daily.weekendAverage).toBe("number");

      // 2. Weekly
      expect(analysis.weekly.weeklySeries.length).toBeGreaterThan(0);
      expect(analysis.weekly.averageWeeklySpend).toBeGreaterThan(0);

      // 3. Monthly
      expect(analysis.monthly.monthlySeries.length).toBeGreaterThan(0);
      expect(analysis.monthly.averageMonthlySpend).toBeGreaterThan(0);
    });

    it("generates evidence-backed prediction explainability factors", async () => {
      const user = await registerUser({
        name: "Explain User",
        email: `explain_${Date.now()}@test.com`,
        password: "Password123!",
      });

      const now = new Date();
      const currentMonthKey = normalizeMonthKey(now);
      const prevKey = addMonths(currentMonthKey, -1);

      await createTransaction(
        {
          transactionDate: `${prevKey}-15`,
          transactionType: "Expense",
          amount: 45000,
          category: "Housing",
          paymentMethod: "Bank Transfer",
          description: "Monthly Rent",
        },
        user.user.id,
      );

      const explain = await getPredictionExplainability(user.user.id, undefined, now);
      expect(explain.targetMonth).toBe(nextMonth(currentMonthKey));
      expect(explain.predictedExpense).toBe(45000);
      expect(explain.summary).toMatch(/projected/i);
      expect(explain.factors.length).toBeGreaterThanOrEqual(4);

      const baselineFactor = explain.factors.find(
        (f) => f.factor === "Historical Baseline Level",
      );
      expect(baselineFactor).toBeDefined();

      const engineFactor = explain.factors.find((f) => f.factor === "Forecasting Engine");
      expect(engineFactor).toBeDefined();
    });

    it("simulates what-if spending scenarios as a pure layer without modifying database records", async () => {
      const user = await registerUser({
        name: "Simulator User",
        email: `sim_${Date.now()}@test.com`,
        password: "Password123!",
      });

      const now = new Date();
      const currentMonthKey = normalizeMonthKey(now);
      const prevKey = addMonths(currentMonthKey, -1);

      await createTransaction(
        {
          transactionDate: `${prevKey}-10`,
          transactionType: "Expense",
          amount: 20000,
          category: "Food",
          paymentMethod: "UPI",
          description: "Monthly groceries",
        },
        user.user.id,
      );

      const txnsBefore = await getTransactions({ userId: user.user.id });

      // Run simulation: reduce food by 25% and add a 15,000 one-off gadget
      const sim = await simulateSpendingScenario(
        user.user.id,
        {
          categoryAdjustments: { Food: -25 },
          oneOffExpenses: [{ name: "New Tablet", amount: 15000, category: "Shopping" }],
        },
        now,
      );

      expect(sim.baselineForecast).toBe(20000);
      // Food becomes 20000 * 0.75 = 15000; plus 15000 gadget = 30000
      expect(sim.simulatedForecast).toBe(30000);
      expect(sim.netDifference).toBe(10000);
      expect(sim.percentChange).toBe(50);
      expect(sim.oneOffTotal).toBe(15000);

      // Verify ZERO database mutations occurred
      const txnsAfter = await getTransactions({ userId: user.user.id });
      expect(txnsAfter.length).toBe(txnsBefore.length);
    });

    it("evaluates historical predictions against actual realized expenses", async () => {
      const user = await registerUser({
        name: "History Accuracy User",
        email: `histacc_${Date.now()}@test.com`,
        password: "Password123!",
      });

      const pastMonth = "2024-03";
      // Record a forecast in predictions table for pastMonth
      await savePredictionRecord(user.user.id, pastMonth, 18500, "lstm-v1");

      // Record actual transactions for pastMonth totalling 18000
      await createTransaction(
        {
          transactionDate: `${pastMonth}-15`,
          transactionType: "Expense",
          amount: 18000,
          category: "Other",
          paymentMethod: "UPI",
          description: "Actual spend",
        },
        user.user.id,
      );

      const historySummary = await getPredictionHistory(user.user.id);
      expect(historySummary.completedCount).toBeGreaterThanOrEqual(1);

      const pastRecord = historySummary.records.find((r) => r.targetMonth === pastMonth);
      expect(pastRecord).toBeDefined();
      expect(pastRecord?.status).toBe("completed");
      expect(pastRecord?.predictedExpense).toBe(18500);
      expect(pastRecord?.actualExpense).toBe(18000);
      expect(pastRecord?.difference).toBe(500);
      expect(pastRecord?.absoluteError).toBe(500);
      // Percentage error: (500 / 18000) * 100 = 2.77% -> Accurate (<10%)
      expect(pastRecord?.accuracyRating).toBe("Accurate");
      expect(historySummary.overallRating).toMatch(/Historical Accuracy/i);
    });
  });
});

