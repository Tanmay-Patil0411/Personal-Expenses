import { db } from "@/db";
import { modelRuns, predictions } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getTransactions } from "@/lib/transactionService";
import { getSettings } from "@/lib/settingsService";
import { getBudgets } from "@/lib/budgetService";
import { generateSyntheticTransactions } from "@/lib/demo";
import { buildMonthlyExpenseDataset } from "./dataset";
import { trainModel, type TrainSettings } from "./train";
import { predictNext } from "./predict";
import {
  saveArtifacts,
  loadEval,
  type ModelMeta,
  type EvalPayload,
  validateModelCompatibility,
} from "./persist";
import { getModel, isModelTrained, invalidateModel } from "./modelManager";
import {
  nextMonth,
  addMonths,
  minRequiredMonths,
  normalizeMonthKey,
  getDaysInMonth,
  getMonthName,
} from "@/lib/config";
import type { Transaction } from "@/lib/types";
import {
  getTrainingRecords,
  getActiveTrainingDataset,
} from "@/lib/trainingService";

export interface TrainingOutcome {
  ok: boolean;
  insufficient?: boolean;
  error?: string;
  modelVersion: string;
  targetMonth: string;
  nextForecast: number;
  evaluation?: EvalPayload | null;
  monthsUsed: number;
  datasetMode?: string;
  dataRange?: { startDate: string; endDate: string };
}

// Active training mutex locks per user to prevent concurrent conflicting runs
const trainingLocks = new Set<string>();

function lockKey(userId?: number): string {
  return `user_${userId ?? "default"}`;
}

export function isTrainingInProgress(userId?: number): boolean {
  return trainingLocks.has(lockKey(userId));
}

export interface RunTrainingOptions {
  datasetMode?: string;
  sequenceLength?: number;
  epochs?: number;
  batchSize?: number;
}

// Run the full LSTM training workflow and persist artifacts + DB records.
export async function runTrainingPipeline(
  userId?: number,
  options?: RunTrainingOptions,
): Promise<TrainingOutcome> {
  const key = lockKey(userId);
  if (trainingLocks.has(key)) {
    return {
      ok: false,
      error: "A training job is already in progress. Please wait for it to complete.",
      modelVersion: "",
      targetMonth: "",
      nextForecast: 0,
      monthsUsed: 0,
    };
  }

  trainingLocks.add(key);

  try {
    const settings = await getSettings(userId);
    const seqLen = options?.sequenceLength ?? settings.sequenceLength;
    const minMonths = minRequiredMonths(seqLen);

    const trainSettings: TrainSettings = {
      sequenceLength: seqLen,
      valMonths: settings.valMonths,
      testMonths: settings.testMonths,
      epochs: options?.epochs ?? settings.epochs,
      batchSize: options?.batchSize ?? settings.batchSize,
      modelVersion: settings.modelVersion,
    };

    let txns: Transaction[] = [];
    const mode = options?.datasetMode ?? settings.datasetMode; // "kaggle" | "real" | "user" | "demo"

    if (mode === "kaggle" || mode === "external") {
      // KAGGLE / EXTERNAL TRAINING DATASET: read from training_records
      txns = await getTrainingRecords(userId);
      if (txns.length === 0) {
        return {
          ok: false,
          insufficient: true,
          error:
            "No external training dataset found. Please upload a Kaggle dataset in the Model Training module.",
          modelVersion: settings.modelVersion,
          targetMonth: "",
          nextForecast: 0,
          monthsUsed: 0,
          datasetMode: "kaggle",
        };
      }
    } else if (mode === "demo") {
      // DEMO BENCHMARK MODE: Generate reproducible synthetic data
      const synthetic = generateSyntheticTransactions({ months: 60, seed: 42 });
      txns = synthetic.map((s, idx) => ({
        id: idx + 1,
        userId: userId ?? null,
        transactionDate: s.transactionDate,
        transactionType: s.transactionType,
        amount: s.amount,
        category: s.category,
        paymentMethod: s.paymentMethod,
        description: s.description ?? null,
        externalTransactionId: s.externalTransactionId ?? null,
      }));
    } else {
      // USER PERSONAL DATA MODE: Read exclusively from user's personal PostgreSQL transactions
      txns = await getTransactions({ userId });
      if (txns.length === 0) {
        return {
          ok: false,
          insufficient: true,
          error:
            "No personal transactions found in your database. When dataset mode is 'real', you must add or import personal expense records first, or switch to 'kaggle' / 'demo' mode in Model Training.",
          modelVersion: settings.modelVersion,
          targetMonth: "",
          nextForecast: 0,
          monthsUsed: 0,
          datasetMode: "real",
        };
      }
    }

    const dataset = buildMonthlyExpenseDataset(txns);

    if (dataset.series.length < minMonths) {
      return {
        ok: false,
        insufficient: true,
        error: `Insufficient history for ${mode} mode: requires at least ${minMonths} months of expense records (found ${dataset.series.length} months from ${txns.length} transactions).`,
        modelVersion: settings.modelVersion,
        targetMonth: "",
        nextForecast: 0,
        monthsUsed: dataset.series.length,
        datasetMode: mode,
      };
    }

    // Record a "running" model run in DB
    const [run] = await db
      .insert(modelRuns)
      .values({
        userId: userId ?? null,
        modelVersion: settings.modelVersion,
        datasetMode: mode,
        dataStartDate: dataset.startDate,
        dataEndDate: dataset.endDate,
        trainingStart: new Date(),
        sequenceLength: seqLen,
        trainingStatus: "running",
      })
      .returning();

    try {
      const result = await trainModel(
        dataset.series,
        dataset.monthKeys,
        trainSettings,
      );

      const meta: ModelMeta = {
        modelVersion: settings.modelVersion,
        sequenceLength: seqLen,
        trainMonths: result.split.train.length,
        valMonths: result.split.val.length,
        testMonths: result.split.test.length,
        firstMonth: dataset.monthKeys[0],
        lastMonth: dataset.monthKeys[dataset.monthKeys.length - 1],
        targetMonth: result.targetMonth,
        trainStart: result.trainStartISO,
        trainEnd: result.trainEndISO,
        epochs: options?.epochs ?? settings.epochs,
        batchSize: options?.batchSize ?? settings.batchSize,
        savedAt: new Date().toISOString(),
        datasetMode: mode,
        dateRange: { startDate: dataset.startDate, endDate: dataset.endDate },
        userId: userId ?? null,
      };

      const evalData: EvalPayload = {
        targetMonth: result.targetMonth,
        nextForecast: result.nextForecast,
        evaluation: result.evaluation,
        baselines: result.baselines,
        history: result.history,
        trainMonths: result.split.train.length,
        valMonths: result.split.val.length,
        testMonths: result.split.test.length,
        modelVersion: settings.modelVersion,
      };

      // Atomically persist artifacts to persistent disk (staging -> swap)
      await saveArtifacts(result.model, result.scaler, meta, evalData, userId);

      // Invalidate in-memory cache so next prediction loads the freshly trained model
      invalidateModel(userId);

      // Persist metrics on the model run in DB
      await db
        .update(modelRuns)
        .set({
          trainingEnd: new Date(result.trainEndISO),
          trainingStatus: "completed",
          mae: String(result.evaluation.metrics.mae),
          rmse: String(result.evaluation.metrics.rmse),
          mape:
            result.evaluation.metrics.mape === null
              ? null
              : String(result.evaluation.metrics.mape),
          trainSamples: result.split.train.length,
          valSamples: result.split.val.length,
          testSamples: result.split.test.length,
        })
        .where(eq(modelRuns.id, run.id));

      // Only upsert into user predictions table if training was explicitly performed on user personal data
      if (mode === "real") {
        const deleteCondition =
          userId != null
            ? and(
                eq(predictions.targetMonth, result.targetMonth),
                eq(predictions.userId, userId),
              )
            : eq(predictions.targetMonth, result.targetMonth);
        await db.delete(predictions).where(deleteCondition);

        await db.insert(predictions).values({
          userId: userId ?? null,
          targetMonth: result.targetMonth,
          predictedExpense: String(Math.round(result.nextForecast * 100) / 100),
          modelVersion: settings.modelVersion,
        });
      }

      return {
        ok: true,
        modelVersion: settings.modelVersion,
        targetMonth: result.targetMonth,
        nextForecast: result.nextForecast,
        evaluation: evalData,
        monthsUsed: dataset.series.length,
        datasetMode: settings.datasetMode,
        dataRange: { startDate: dataset.startDate, endDate: dataset.endDate },
      };
    } catch (trainErr) {
      // Training or validation failed: update DB with error info
      const errorMsg =
        trainErr instanceof Error ? trainErr.message : String(trainErr);
      await db
        .update(modelRuns)
        .set({
          trainingStatus: "failed",
          errorMessage: errorMsg,
          trainingEnd: new Date(),
        })
        .where(eq(modelRuns.id, run.id));

      return {
        ok: false,
        error: errorMsg,
        modelVersion: settings.modelVersion,
        targetMonth: "",
        nextForecast: 0,
        monthsUsed: dataset.series.length,
        datasetMode: settings.datasetMode,
      };
    }
  } finally {
    trainingLocks.delete(key);
  }
}

export interface PersonalizedForecast {
  targetMonth: string;
  predictedExpense: number | null;
  status: "ready" | "baseline" | "run_rate" | "insufficient_history" | "no_data";
  method: string;
  explanation: string;
  monthsCount: number;
  requiredMonths: number;
  historicalSeries: { month: string; amount: number }[];
  budgetComparison?: {
    budget: number | null;
    difference: number | null;
    status: "under" | "over" | "no_budget";
  };
  metrics?: {
    completedMonthsCount: number;
    currentMonthSpent: number;
    dailyRunRate?: number;
    elapsedDays?: number;
    daysInMonth?: number;
  };
  previousMonthExpense?: number | null;
  changeAmount?: number | null;
  changePercent?: number | null;
  historicalDailyAverage?: number | null;
  forecastDailyAverage?: number | null;
  uncertaintyInterval?: {
    lower: number;
    upper: number;
    margin: number;
    confidenceLevel: string;
  } | null;
  evaluationMetrics?: {
    mae: number | null;
    rmse: number | null;
    wape: number | null;
    mape: number | null;
  } | null;
  budgetRisk?: {
    budget: number | null;
    difference: number | null;
    status: "under" | "over" | "no_budget";
    riskLevel: "low" | "medium" | "high" | "exceeded" | "no_budget";
    projectedExhaustionDate: string | null;
    utilizationPercent: number | null;
  };
  reliability?: {
    score: number;
    level: "High" | "Moderate" | "Preliminary" | "Insufficient";
    reasons: string[];
  };
}

interface ForecastContext {
  userId?: number;
  referenceDate: Date;
  targetMonth: string;
  txns: Transaction[];
  expenseTxns: Transaction[];
  dataset: ReturnType<typeof buildMonthlyExpenseDataset>;
  overallBudget: number | null;
}

async function enrichForecast(
  base: Omit<
    PersonalizedForecast,
    | "previousMonthExpense"
    | "changeAmount"
    | "changePercent"
    | "historicalDailyAverage"
    | "forecastDailyAverage"
    | "uncertaintyInterval"
    | "evaluationMetrics"
    | "budgetRisk"
    | "reliability"
  >,
  ctx: ForecastContext,
): Promise<PersonalizedForecast> {
  const { userId, referenceDate, targetMonth, dataset, overallBudget } = ctx;
  const predVal = base.predictedExpense;
  const completedSeries = dataset.completedSeries;
  const completedKeys = dataset.completedMonthKeys;
  const currentMonthSpent = dataset.currentMonthTotal;

  const [ty, tm] = targetMonth.split("-").map(Number);
  const daysInTarget = getDaysInMonth(ty, tm);
  const forecastDailyAverage =
    predVal != null && daysInTarget > 0
      ? Math.round((predVal / daysInTarget) * 100) / 100
      : null;

  // Historical daily average across completed months or current month
  let historicalDailyAverage: number | null = null;
  if (completedSeries.length > 0) {
    let totalDays = 0;
    for (const k of completedKeys) {
      const [y, m] = k.split("-").map(Number);
      totalDays += getDaysInMonth(y, m);
    }
    const totalSpent = completedSeries.reduce((a, b) => a + b, 0);
    historicalDailyAverage = totalDays > 0 ? Math.round((totalSpent / totalDays) * 100) / 100 : null;
  } else if (dataset.hasCurrentMonth) {
    const [cy, cm] = normalizeMonthKey(referenceDate).split("-").map(Number);
    const daysInCurr = getDaysInMonth(cy, cm);
    const elapsed = Math.max(1, Math.min(daysInCurr, referenceDate.getDate()));
    historicalDailyAverage = Math.round((currentMonthSpent / elapsed) * 100) / 100;
  }

  // Previous month expense (most recent completed month or current month)
  let previousMonthExpense: number | null = null;
  if (completedSeries.length > 0) {
    previousMonthExpense = completedSeries[completedSeries.length - 1];
  } else if (dataset.hasCurrentMonth && currentMonthSpent > 0) {
    previousMonthExpense = currentMonthSpent;
  }

  // Spending Change relative to previous month
  let changeAmount: number | null = null;
  let changePercent: number | null = null;
  if (predVal != null && previousMonthExpense != null) {
    changeAmount = Math.round((predVal - previousMonthExpense) * 100) / 100;
    changePercent =
      previousMonthExpense > 0
        ? Math.round(((predVal - previousMonthExpense) / previousMonthExpense) * 1000) / 10
        : null;
  }

  // Evaluation metrics from saved evaluation or latest model run
  const evalData = loadEval(userId);
  const runCondition = userId != null ? eq(modelRuns.userId, userId) : undefined;
  const [latestRun] = await db
    .select()
    .from(modelRuns)
    .where(runCondition)
    .orderBy(desc(modelRuns.createdAt))
    .limit(1);

  const evaluationMetrics = {
    mae: evalData?.evaluation?.metrics?.mae ?? (latestRun?.mae ? Number(latestRun.mae) : null),
    rmse: evalData?.evaluation?.metrics?.rmse ?? (latestRun?.rmse ? Number(latestRun.rmse) : null),
    wape: evalData?.evaluation?.metrics?.wape ?? null,
    mape: evalData?.evaluation?.metrics?.mape ?? (latestRun?.mape ? Number(latestRun.mape) : null),
  };

  // Prediction interval (Uncertainty band derived rigorously from residual RMSE / dispersion)
  let uncertaintyInterval: {
    lower: number;
    upper: number;
    margin: number;
    confidenceLevel: string;
  } | null = null;

  if (predVal != null) {
    let sigma = 0;
    if (evaluationMetrics.rmse && evaluationMetrics.rmse > 0) {
      sigma = evaluationMetrics.rmse;
    } else if (completedSeries.length >= 2) {
      const mean = completedSeries.reduce((a, b) => a + b, 0) / completedSeries.length;
      const variance =
        completedSeries.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
        (completedSeries.length - 1);
      sigma = Math.sqrt(variance);
    } else {
      sigma = predVal * 0.15; // default 15% dispersion when series has < 2 points
    }

    const margin = Math.round(1.96 * sigma * 100) / 100;
    const lower = Math.max(0, Math.round((predVal - margin) * 100) / 100);
    const upper = Math.round((predVal + margin) * 100) / 100;

    uncertaintyInterval = {
      lower,
      upper,
      margin,
      confidenceLevel: "95% Prediction Interval",
    };
  }

  // Budget Risk
  let budgetRisk: {
    budget: number | null;
    difference: number | null;
    status: "under" | "over" | "no_budget";
    riskLevel: "low" | "medium" | "high" | "exceeded" | "no_budget";
    projectedExhaustionDate: string | null;
    utilizationPercent: number | null;
  } = {
    budget: overallBudget,
    difference: null,
    status: "no_budget",
    riskLevel: "no_budget",
    projectedExhaustionDate: null,
    utilizationPercent: null,
  };

  if (overallBudget != null && predVal != null) {
    const diff = Math.round((predVal - overallBudget) * 100) / 100;
    const utilPct = overallBudget > 0 ? Math.round((predVal / overallBudget) * 1000) / 10 : null;
    const isOver = diff > 0;
    let riskLevel: "low" | "medium" | "high" | "exceeded" = isOver ? "exceeded" : "low";
    if (!isOver && utilPct != null) {
      if (utilPct >= 85) riskLevel = "high";
      else if (utilPct >= 70) riskLevel = "medium";
    }

    let projectedExhaustionDate: string | null = null;
    if (isOver && forecastDailyAverage != null && forecastDailyAverage > 0) {
      const dayIndex = Math.min(
        daysInTarget,
        Math.max(1, Math.floor(overallBudget / forecastDailyAverage)),
      );
      projectedExhaustionDate = `${targetMonth}-${String(dayIndex).padStart(2, "0")}`;
    }

    budgetRisk = {
      budget: overallBudget,
      difference: diff,
      status: isOver ? "over" : "under",
      riskLevel,
      projectedExhaustionDate,
      utilizationPercent: utilPct,
    };
  }

  // Reliability
  let score = 0;
  let level: "High" | "Moderate" | "Preliminary" | "Insufficient" = "Insufficient";
  const reasons: string[] = [];

  if (predVal == null) {
    score = 0;
    level = "Insufficient";
    reasons.push("No personal expense data recorded.");
  } else if (base.status === "ready") {
    score = 88;
    if (evaluationMetrics.wape != null) {
      if (evaluationMetrics.wape < 15) score += 7;
      else if (evaluationMetrics.wape > 30) score -= 12;
    }
    level = score >= 80 ? "High" : "Moderate";
    reasons.push(
      `Generated by personalized LSTM deep learning network with ${base.monthsCount} months of history.`,
    );
    reasons.push("Evaluated chronologically without data leakage.");
  } else if (base.status === "baseline") {
    if (completedSeries.length >= 3) {
      score = 70;
      level = "Moderate";
      reasons.push(
        `Computed from a ${completedSeries.length}-month weighted moving average baseline.`,
      );
    } else {
      score = 55;
      level = "Preliminary";
      reasons.push(
        `Limited history (${completedSeries.length} completed month(s)); baseline uses available periods.`,
      );
    }
  } else if (base.status === "run_rate") {
    score = 35;
    level = "Preliminary";
    reasons.push("Extrapolated from partial current-month daily spending pace.");
    reasons.push("No completed historical months recorded yet.");
  }

  // Auto-record to predictions table if predictedExpense is not null
  if (predVal != null) {
    try {
      await savePredictionRecord(
        userId,
        targetMonth,
        predVal,
        latestRun?.modelVersion ?? "baseline",
      );
    } catch {
      // non-fatal if table update fails
    }
  }

  return {
    ...base,
    previousMonthExpense,
    changeAmount,
    changePercent,
    historicalDailyAverage,
    forecastDailyAverage,
    uncertaintyInterval,
    evaluationMetrics,
    budgetRisk,
    reliability: {
      score: Math.min(100, Math.max(0, score)),
      level,
      reasons,
    },
  };
}

/**
 * Generates a personalized next-month expenditure forecast strictly derived
 * from the authenticated user's own financial transactions.
 *
 * It strictly separates completed historical months from the current ongoing month:
 * - When 0 completed months exist and only current-month expenses are recorded,
 *   it produces an explicit daily run-rate projection rather than repeating the current total.
 * - When 1 to 5 completed months exist, it uses a weighted moving average baseline of completed months.
 * - When >= 6 completed months exist and a validated personal model exists, it executes LSTM inference.
 * - External training records and Kaggle datasets are strictly excluded.
 */
export async function getPersonalizedForecast(
  userId?: number,
  referenceDate: Date = new Date(),
): Promise<PersonalizedForecast> {
  const currentCalendarMonth = normalizeMonthKey(referenceDate);
  const targetMonth = nextMonth(currentCalendarMonth);
  const settings = await getSettings(userId);
  const seqLen = settings.sequenceLength || 6;

  // 1. Fetch authenticated user's personal expense transactions only
  const txns = await getTransactions({ userId });
  const expenseTxns = txns.filter((t) => t.transactionType === "Expense");

  // 2. Build partitioned monthly expense dataset
  const dataset = buildMonthlyExpenseDataset(expenseTxns, referenceDate);
  const completedKeys = dataset.completedMonthKeys;
  const completedSeries = dataset.completedSeries;
  const completedCount = completedKeys.length;
  const currentMonthSpent = dataset.currentMonthTotal;

  // Historical series for frontend charts (includes all recorded points)
  const historicalSeries = dataset.monthKeys.map((k, idx) => ({
    month: k,
    amount: dataset.series[idx],
  }));

  // Target month budget comparison
  const budgets = await getBudgets(targetMonth, userId);
  const overallBudget = budgets.find((b) => !b.category)?.budgetAmount ?? null;

  function buildBudgetComp(pred: number | null) {
    if (pred == null || overallBudget == null) {
      return { budget: overallBudget, difference: null, status: "no_budget" as const };
    }
    const diff = Math.round((pred - overallBudget) * 100) / 100;
    return {
      budget: overallBudget,
      difference: diff,
      status: diff > 0 ? ("over" as const) : ("under" as const),
    };
  }

  const ctx: ForecastContext = {
    userId,
    referenceDate,
    targetMonth,
    txns,
    expenseTxns,
    dataset,
    overallBudget,
  };

  // CASE 1: No expense history at all
  if (expenseTxns.length === 0 || (completedCount === 0 && !dataset.hasCurrentMonth)) {
    return enrichForecast(
      {
        targetMonth,
        predictedExpense: null,
        status: "no_data",
        method: "None",
        explanation:
          "No personal expense records found. Add expense transactions to generate personalized spending predictions.",
        monthsCount: 0,
        requiredMonths: seqLen,
        historicalSeries: [],
        budgetComparison: buildBudgetComp(null),
        metrics: {
          completedMonthsCount: 0,
          currentMonthSpent: 0,
        },
      },
      ctx,
    );
  }

  // CASE 2: Current month only (0 completed historical months)
  // Compute run-rate estimate based on elapsed days, avoiding blindly copying current month
  if (completedCount === 0 && dataset.hasCurrentMonth) {
    const [cy, cm] = currentCalendarMonth.split("-").map(Number);
    const [ty, tm] = targetMonth.split("-").map(Number);
    const daysInCurrentMonth = getDaysInMonth(cy, cm);
    const daysInTargetMonth = getDaysInMonth(ty, tm);
    const elapsedDays = Math.max(1, Math.min(daysInCurrentMonth, referenceDate.getDate()));
    const dailyRate = currentMonthSpent / elapsedDays;
    const runRateForecast = Math.round(dailyRate * daysInTargetMonth * 100) / 100;

    const currMonthName = getMonthName(cm);
    const targetMonthName = getMonthName(tm);

    return enrichForecast(
      {
        targetMonth,
        predictedExpense: runRateForecast,
        status: "run_rate",
        method: "Current Month Run-Rate Projection",
        explanation: `Run-rate estimate based on ₹${currentMonthSpent.toLocaleString("en-IN", { minimumFractionDigits: 2 })} spent across the first ${elapsedDays} day(s) of ${currMonthName} (₹${dailyRate.toFixed(2)}/day), projected across ${targetMonthName} (${daysInTargetMonth} days). This estimate assumes your daily spending pace continues and is not an LSTM forecast.`,
        monthsCount: 1,
        requiredMonths: seqLen,
        historicalSeries,
        budgetComparison: buildBudgetComp(runRateForecast),
        metrics: {
          completedMonthsCount: 0,
          currentMonthSpent,
          dailyRunRate: Math.round(dailyRate * 100) / 100,
          elapsedDays,
          daysInMonth: daysInCurrentMonth,
        },
      },
      ctx,
    );
  }

  // CASE 3: 1 to (seqLen - 1) completed months (e.g. 1 to 5 completed months)
  // Use documented baseline methods over completed months only
  if (completedCount < seqLen) {
    let baseline = 0;
    let methodDesc = "";

    if (completedCount === 1) {
      baseline = completedSeries[0];
      const [lastY, lastM] = completedKeys[0].split("-").map(Number);
      methodDesc = `Personal Historical Baseline (${getMonthName(lastM)} ${lastY})`;
    } else if (completedCount === 2) {
      // 2 completed months: weighted average giving 60% to most recent month
      baseline = completedSeries[0] * 0.4 + completedSeries[1] * 0.6;
      methodDesc = "Personal Historical Baseline (2-Month Weighted Average)";
    } else {
      // 3 to 5 completed months: 3-month weighted average (20%, 30%, 50%)
      const recent3 = completedSeries.slice(-3);
      baseline = recent3[0] * 0.2 + recent3[1] * 0.3 + recent3[2] * 0.5;
      methodDesc = "Personal Historical Baseline (3-Month Weighted Average)";
    }

    const roundedBaseline = Math.round(baseline * 100) / 100;

    return enrichForecast(
      {
        targetMonth,
        predictedExpense: roundedBaseline,
        status: "baseline",
        method: methodDesc,
        explanation: `Personal baseline forecast calculated from your ${completedCount} completed month(s) of spending. Add ${seqLen - completedCount} more completed month(s) to train and enable a personalized LSTM neural network.`,
        monthsCount: completedCount + (dataset.hasCurrentMonth ? 1 : 0),
        requiredMonths: seqLen,
        historicalSeries,
        budgetComparison: buildBudgetComp(roundedBaseline),
        metrics: {
          completedMonthsCount: completedCount,
          currentMonthSpent,
        },
      },
      ctx,
    );
  }

  // CASE 4: >= seqLen completed months (>= 6 completed months)
  // Check if a personalized model was trained on user data
  const loaded = await getModel(userId);
  if (loaded) {
    const validation = validateModelCompatibility(loaded.meta, userId, completedKeys);
    if (validation.valid && completedSeries.length >= loaded.meta.sequenceLength) {
      try {
        const inputSeq = completedSeries.slice(-loaded.meta.sequenceLength);
        const predVal = await predictNext(
          loaded.model,
          loaded.scaler,
          inputSeq,
          loaded.meta.sequenceLength,
        );
        const rounded = Math.round(predVal * 100) / 100;
        return enrichForecast(
          {
            targetMonth,
            predictedExpense: rounded,
            status: "ready",
            method: "Personalized LSTM Deep Learning",
            explanation: `Personalized forecast generated by your trained LSTM neural network (${loaded.meta.modelVersion}) based on ${completedCount} completed months of your personal expenditure.`,
            monthsCount: completedCount + (dataset.hasCurrentMonth ? 1 : 0),
            requiredMonths: seqLen,
            historicalSeries,
            budgetComparison: buildBudgetComp(rounded),
            metrics: {
              completedMonthsCount: completedCount,
              currentMonthSpent,
            },
          },
          ctx,
        );
      } catch {
        // Fall back gracefully to moving average if model inference encounters error
      }
    }
  }

  // If model is untrained or was trained on external Kaggle data, compute 3-month weighted moving average
  const recent3 = completedSeries.slice(-3);
  const weights = [0.2, 0.3, 0.5];
  const wSum = recent3.reduce((acc, v, i) => acc + v * (weights[i] ?? 0.33), 0);
  const movingAvg = Math.round(wSum * 100) / 100;

  return enrichForecast(
    {
      targetMonth,
      predictedExpense: movingAvg,
      status: "baseline",
      method: "Personal Moving Average Baseline",
      explanation: `Personal baseline forecast calculated from your recent spending history (${completedCount} completed months). To train a personalized LSTM model tailored to your financial patterns, visit Model Training.`,
      monthsCount: completedCount + (dataset.hasCurrentMonth ? 1 : 0),
      requiredMonths: seqLen,
      historicalSeries,
      budgetComparison: buildBudgetComp(movingAvg),
      metrics: {
        completedMonthsCount: completedCount,
        currentMonthSpent,
      },
    },
    ctx,
  );
}

export interface ForecastStatus {
  hasModel: boolean;
  modelStatus: "untrained" | "training" | "trained" | "error";
  modelVersion: string | null;
  targetMonth: string | null;
  predictedExpense: number | null;
  predictionStatus?: string;
  forecastingMethod?: string;
  explanation?: string;
  datasetMode: string | null;
  datasetSource: string | null;
  dataStartDate: string | null;
  dataEndDate: string | null;
  lastTrainedAt: string | null;
  availableMonths: number;
  requiredMonths: number;
  canTrain: boolean;
  insufficientReason: string | null;
  activeDatasetCount?: number;
  latestRun: {
    status: string;
    mae: number | null;
    rmse: number | null;
    mape: number | null;
    trainSamples: number | null;
    datasetMode?: string | null;
    errorMessage?: string | null;
    dataStartDate?: string | null;
    dataEndDate?: string | null;
  } | null;
  meta: ModelMeta | null;
  evaluation: EvalPayload | null;
  personalized: PersonalizedForecast;
}

export async function getForecastStatus(
  userId?: number,
): Promise<ForecastStatus> {
  const inProgress = isTrainingInProgress(userId);
  const modelCheck = await isModelTrained(userId);
  const personalized = await getPersonalizedForecast(userId);
  const settings = await getSettings(userId);
  const requiredMonths = minRequiredMonths(settings.sequenceLength);
  const activeDatasetMode = settings.datasetMode;

  let availableMonths = 0;
  let activeDatasetCount = 0;

  if (activeDatasetMode === "kaggle" || activeDatasetMode === "external") {
    const kaggleTxns = await getTrainingRecords(userId);
    activeDatasetCount = kaggleTxns.length;
    const kaggleExpenseTxns = kaggleTxns.filter((t) => t.transactionType === "Expense");
    const uniqueMonths = new Set(kaggleExpenseTxns.map((t) => t.transactionDate.slice(0, 7)));
    availableMonths = uniqueMonths.size;
  } else if (activeDatasetMode === "demo") {
    availableMonths = 60;
    activeDatasetCount = 60;
  } else {
    // real mode: check user's personal PostgreSQL transactions
    const userTxns = await getTransactions({ userId });
    activeDatasetCount = userTxns.length;
    const userExpenseTxns = userTxns.filter((t) => t.transactionType === "Expense");
    const uniqueMonths = new Set(userExpenseTxns.map((t) => t.transactionDate.slice(0, 7)));
    availableMonths = uniqueMonths.size;
  }

  const canTrain = availableMonths >= requiredMonths;
  let insufficientReason: string | null = null;
  if (!canTrain) {
    if (activeDatasetMode === "real") {
      insufficientReason = `Your personal database has ${availableMonths} month${availableMonths === 1 ? "" : "s"} of records (minimum ${requiredMonths} required for a ${settings.sequenceLength}-month sequence with validation and test windows). To train an LSTM model immediately, switch Dataset Mode to "Kaggle (External Dataset)" or "Demo (Synthetic Benchmark)".`;
    } else if (activeDatasetMode === "kaggle") {
      insufficientReason = `No Kaggle dataset uploaded or it contains only ${availableMonths} month${availableMonths === 1 ? "" : "s"} (minimum ${requiredMonths} required). Please upload a valid CSV in Model Training.`;
    } else {
      insufficientReason = `Insufficient data for training: ${availableMonths} months available, ${requiredMonths} months required.`;
    }
  }

  const runCondition =
    userId != null ? eq(modelRuns.userId, userId) : undefined;

  const [run] = await db
    .select()
    .from(modelRuns)
    .where(runCondition)
    .orderBy(desc(modelRuns.createdAt))
    .limit(1);

  const toNum = (v: unknown) => (v == null ? null : Number(v));

  let modelStatus: "untrained" | "training" | "trained" | "error" = "untrained";
  if (inProgress) {
    modelStatus = "training";
  } else if (modelCheck.trained) {
    modelStatus = "trained";
  } else if (run?.trainingStatus === "failed") {
    modelStatus = "error";
  } else {
    modelStatus = "untrained";
  }

  const evalData = modelCheck.evalData ?? loadEval(userId);
  const meta = modelCheck.meta;
  const currentMode = meta?.datasetMode ?? settings.datasetMode ?? run?.datasetMode ?? "kaggle";
  let datasetSource = "Personal Financial Data";
  if (currentMode === "kaggle" || currentMode === "external") {
    datasetSource = "Kaggle External Dataset";
  } else if (currentMode === "demo") {
    datasetSource = "Synthetic Benchmark Demo";
  }

  return {
    hasModel: modelCheck.trained,
    modelStatus,
    modelVersion: meta?.modelVersion ?? run?.modelVersion ?? null,
    targetMonth: personalized.targetMonth,
    predictedExpense: personalized.predictedExpense,
    predictionStatus: personalized.status,
    forecastingMethod: personalized.method,
    explanation: personalized.explanation,
    datasetMode: currentMode,
    datasetSource,
    dataStartDate: meta?.dateRange?.startDate ?? run?.dataStartDate ?? null,
    dataEndDate: meta?.dateRange?.endDate ?? run?.dataEndDate ?? null,
    lastTrainedAt: meta?.savedAt ?? (run?.trainingEnd ? String(run.trainingEnd) : null),
    availableMonths,
    requiredMonths,
    canTrain,
    insufficientReason,
    activeDatasetCount,
    latestRun: run
      ? {
          status: run.trainingStatus,
          mae: toNum(run.mae),
          rmse: toNum(run.rmse),
          mape: toNum(run.mape),
          trainSamples: run.trainSamples ?? null,
          datasetMode: run.datasetMode,
          errorMessage: run.errorMessage,
          dataStartDate: run.dataStartDate,
          dataEndDate: run.dataEndDate,
        }
      : null,
    meta,
    evaluation: evalData,
    personalized,
  };
}

// Produce a live forecast for the user's personal timeline
export async function getLiveForecast(userId?: number): Promise<{
  targetMonth: string;
  predictedExpense: number;
  modelVersion: string;
  method: string;
} | null> {
  const personalized = await getPersonalizedForecast(userId);
  if (personalized.predictedExpense == null) return null;

  return {
    targetMonth: personalized.targetMonth,
    predictedExpense: personalized.predictedExpense,
    modelVersion: "lstm-v1",
    method: personalized.method,
  };
}

export async function invalidateUserPrediction(userId?: number): Promise<void> {
  invalidateModel(userId);
  if (userId != null) {
    await db.delete(predictions).where(eq(predictions.userId, userId));
  } else {
    await db.delete(predictions);
  }
}

// Compare a forecast to the configured overall budget for the target month.
export async function forecastVsBudget(
  targetMonth: string,
  predicted: number,
  userId?: number,
): Promise<{ budget: number | null; difference: number | null }> {
  const budgets = await getBudgets(targetMonth, userId);
  const overall = budgets.find((b) => !b.category);
  if (!overall) return { budget: null, difference: null };
  return {
    budget: overall.budgetAmount,
    difference: Math.round((predicted - overall.budgetAmount) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Multi-Horizon Forecasting (7d, 30d, 3m, 6m)
// ---------------------------------------------------------------------------
export type ForecastHorizon = "7d" | "30d" | "3m" | "6m";

export interface DailyForecastPoint {
  date: string;
  dayName: string;
  predictedAmount: number;
  lowerBound: number;
  upperBound: number;
}

export interface MonthlyForecastPoint {
  month: string;
  monthName: string;
  predictedAmount: number;
  lowerBound: number;
  upperBound: number;
  budget: number | null;
}

export interface MultiHorizonForecastResult {
  horizon: ForecastHorizon;
  granularity: "daily" | "monthly";
  startDate: string;
  endDate: string;
  totalPredicted: number;
  averagePerUnit: number;
  points: (DailyForecastPoint | MonthlyForecastPoint)[];
  method: string;
  budgetComparison?: {
    budget: number | null;
    difference: number | null;
    status: "under" | "over" | "no_budget";
  };
}

export async function getMultiHorizonForecast(
  userId?: number,
  horizon: ForecastHorizon = "30d",
  referenceDate: Date = new Date(),
): Promise<MultiHorizonForecastResult> {
  const personalized = await getPersonalizedForecast(userId, referenceDate);
  const txns = await getTransactions({ userId });
  const expenseTxns = txns.filter((t) => t.transactionType === "Expense");

  if (horizon === "7d" || horizon === "30d") {
    const numDays = horizon === "7d" ? 7 : 30;
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // Compute day-of-week seasonality from historical daily totals
    const dayTotals = [0, 0, 0, 0, 0, 0, 0];
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    const dailySpendMap = new Map<string, number>();

    for (const t of expenseTxns) {
      dailySpendMap.set(
        t.transactionDate,
        (dailySpendMap.get(t.transactionDate) ?? 0) + Number(t.amount),
      );
    }

    for (const [dateStr, amt] of dailySpendMap.entries()) {
      const d = new Date(dateStr + "T12:00:00Z");
      const dayIdx = d.getUTCDay();
      dayTotals[dayIdx] += amt;
      dayCounts[dayIdx] += 1;
    }

    const dayAverages = dayTotals.map((tot, idx) =>
      dayCounts[idx] > 0 ? tot / dayCounts[idx] : 0,
    );
    const activeDaysCount = dayCounts.reduce((a, b) => a + b, 0);
    const overallDailyMean =
      activeDaysCount > 0 ? dayTotals.reduce((a, b) => a + b, 0) / activeDaysCount : 0;

    // Daily baseline spending rate: prefer forecastDailyAverage or historicalDailyAverage
    const dailyBase =
      personalized.forecastDailyAverage ??
      personalized.historicalDailyAverage ??
      (overallDailyMean > 0 ? overallDailyMean : 500);

    // Compute standard deviation of daily spending
    const dailyAmts = Array.from(dailySpendMap.values());
    let dailySigma = dailyBase * 0.2;
    if (dailyAmts.length >= 2) {
      const m = dailyAmts.reduce((a, b) => a + b, 0) / dailyAmts.length;
      const v =
        dailyAmts.reduce((a, b) => a + Math.pow(b - m, 2), 0) / (dailyAmts.length - 1);
      dailySigma = Math.sqrt(v);
    }
    const margin = Math.round(1.96 * dailySigma * 100) / 100;

    const points: DailyForecastPoint[] = [];
    let runningTotal = 0;
    const startD = new Date(referenceDate);
    startD.setDate(startD.getDate() + 1);

    for (let i = 0; i < numDays; i++) {
      const cur = new Date(startD);
      cur.setDate(cur.getDate() + i);
      const isoDate = cur.toISOString().slice(0, 10);
      const dayIdx = cur.getDay();

      // Seasonality factor
      let factor = 1.0;
      if (overallDailyMean > 0 && dayAverages[dayIdx] > 0) {
        factor = dayAverages[dayIdx] / overallDailyMean;
        factor = Math.max(0.4, Math.min(2.5, factor)); // clamp within sensible bounds
      }

      const predicted = Math.round(dailyBase * factor * 100) / 100;
      runningTotal += predicted;
      const lower = Math.max(0, Math.round((predicted - margin) * 100) / 100);
      const upper = Math.round((predicted + margin) * 100) / 100;

      points.push({
        date: isoDate,
        dayName: dayNames[dayIdx],
        predictedAmount: predicted,
        lowerBound: lower,
        upperBound: upper,
      });
    }

    const totalPredicted = Math.round(runningTotal * 100) / 100;
    const averagePerUnit = Math.round((totalPredicted / numDays) * 100) / 100;

    return {
      horizon,
      granularity: "daily",
      startDate: points[0]?.date ?? "",
      endDate: points[points.length - 1]?.date ?? "",
      totalPredicted,
      averagePerUnit,
      points,
      method: `${personalized.method} with Day-of-Week Seasonality Adjustment`,
    };
  }

  // Medium / Long-term: "3m" or "6m"
  const numMonths = horizon === "3m" ? 3 : 6;
  const targetMonth = personalized.targetMonth;
  const dataset = buildMonthlyExpenseDataset(expenseTxns, referenceDate);
  const completedSeries = [...dataset.completedSeries];

  // Rolling rollout
  const points: MonthlyForecastPoint[] = [];
  const rollingSeq = [...completedSeries];
  if (rollingSeq.length === 0) {
    rollingSeq.push(personalized.predictedExpense ?? 10000);
  }

  const baseSigma =
    personalized.evaluationMetrics?.rmse ??
    (personalized.predictedExpense ? personalized.predictedExpense * 0.15 : 2000);

  let runningTotal = 0;
  for (let k = 0; k < numMonths; k++) {
    const mo = addMonths(targetMonth, k);
    const [y, m] = mo.split("-").map(Number);
    const moName = `${getMonthName(m)} ${y}`;

    // Predict for month k
    let predK = 0;
    if (rollingSeq.length >= 3) {
      const last3 = rollingSeq.slice(-3);
      predK = Math.round((last3[0] * 0.2 + last3[1] * 0.3 + last3[2] * 0.5) * 100) / 100;
    } else {
      predK = personalized.predictedExpense ?? rollingSeq[rollingSeq.length - 1] ?? 10000;
    }

    rollingSeq.push(predK);
    runningTotal += predK;

    // Expanding margin over horizon steps
    const stepMargin = Math.round(1.96 * baseSigma * Math.sqrt(1 + 0.2 * k) * 100) / 100;
    const lower = Math.max(0, Math.round((predK - stepMargin) * 100) / 100);
    const upper = Math.round((predK + stepMargin) * 100) / 100;

    // Fetch budget for month
    const budgets = await getBudgets(mo, userId);
    const overall = budgets.find((b) => !b.category)?.budgetAmount ?? null;

    points.push({
      month: mo,
      monthName: moName,
      predictedAmount: predK,
      lowerBound: lower,
      upperBound: upper,
      budget: overall,
    });
  }

  const totalPredicted = Math.round(runningTotal * 100) / 100;
  const averagePerUnit = Math.round((totalPredicted / numMonths) * 100) / 100;

  return {
    horizon,
    granularity: "monthly",
    startDate: points[0]?.month ?? "",
    endDate: points[points.length - 1]?.month ?? "",
    totalPredicted,
    averagePerUnit,
    points,
    method: `${personalized.method} Autoregressive Multi-Step Rollout`,
  };
}

// ---------------------------------------------------------------------------
// Category-Wise Expense Prediction
// ---------------------------------------------------------------------------
export interface CategoryForecast {
  category: string;
  historicalAverage: number;
  predictedAmount: number;
  changeAmount: number;
  changePercent: number | null;
  shareOfTotal: number;
  categoryBudget: number | null;
  budgetVariance: number | null;
  budgetStatus: "under" | "over" | "no_budget";
  trend: "increasing" | "decreasing" | "stable";
}

export interface CategoryForecastSummary {
  targetMonth: string;
  totalPredicted: number;
  categories: CategoryForecast[];
  highestProjectedCategory: string | null;
  largestIncreaseCategory: string | null;
  largestDecreaseCategory: string | null;
}

export async function getCategoryForecasts(
  userId?: number,
  targetMonth?: string,
  referenceDate: Date = new Date(),
): Promise<CategoryForecastSummary> {
  const personalized = await getPersonalizedForecast(userId, referenceDate);
  const mo = targetMonth ?? personalized.targetMonth;
  const totalPredicted = personalized.predictedExpense ?? 0;

  const txns = await getTransactions({ userId });
  const expenseTxns = txns.filter((t) => t.transactionType === "Expense");

  if (expenseTxns.length === 0 || totalPredicted === 0) {
    return {
      targetMonth: mo,
      totalPredicted: 0,
      categories: [],
      highestProjectedCategory: null,
      largestIncreaseCategory: null,
      largestDecreaseCategory: null,
    };
  }

  // Group by category and month
  const categoryMonthMap = new Map<string, Map<string, number>>();
  const allMonths = new Set<string>();

  for (const t of expenseTxns) {
    const m = t.transactionDate.slice(0, 7);
    allMonths.add(m);
    if (!categoryMonthMap.has(t.category)) {
      categoryMonthMap.set(t.category, new Map());
    }
    const catMap = categoryMonthMap.get(t.category)!;
    catMap.set(m, (catMap.get(m) ?? 0) + Number(t.amount));
  }

  const sortedMonths = Array.from(allMonths).sort();
  const monthsCount = Math.max(1, sortedMonths.length);

  // Budgets for targetMonth
  const targetBudgets = await getBudgets(mo, userId);
  const budgetMap = new Map<string, number>();
  for (const b of targetBudgets) {
    if (b.category) {
      budgetMap.set(b.category, b.budgetAmount);
    }
  }

  // Calculate averages and shares
  const catStats: {
    category: string;
    total: number;
    avg: number;
    recentTrend: "increasing" | "decreasing" | "stable";
  }[] = [];

  let grandHistoricalTotal = 0;

  for (const [cat, moMap] of categoryMonthMap.entries()) {
    let catTotal = 0;
    for (const val of moMap.values()) {
      catTotal += val;
    }
    grandHistoricalTotal += catTotal;
    const catAvg = Math.round((catTotal / monthsCount) * 100) / 100;

    // Trend detection
    let trend: "increasing" | "decreasing" | "stable" = "stable";
    if (sortedMonths.length >= 2) {
      const lastM = sortedMonths[sortedMonths.length - 1];
      const prevM = sortedMonths[sortedMonths.length - 2];
      const lastSpend = moMap.get(lastM) ?? 0;
      const prevSpend = moMap.get(prevM) ?? 0;
      if (prevSpend > 0) {
        const vel = (lastSpend - prevSpend) / prevSpend;
        if (vel >= 0.08) trend = "increasing";
        else if (vel <= -0.08) trend = "decreasing";
      } else if (lastSpend > 0) {
        trend = "increasing";
      }
    }

    catStats.push({
      category: cat,
      total: catTotal,
      avg: catAvg,
      recentTrend: trend,
    });
  }

  // Sort by historical average desc
  catStats.sort((a, b) => b.avg - a.avg);

  const categories: CategoryForecast[] = [];
  let allocatedSum = 0;

  for (let i = 0; i < catStats.length; i++) {
    const item = catStats[i];
    const share = grandHistoricalTotal > 0 ? item.total / grandHistoricalTotal : 1 / catStats.length;
    let predAmt = Math.round(totalPredicted * share * 100) / 100;

    // Last category absorbs any penny rounding discrepancy
    if (i === catStats.length - 1) {
      predAmt = Math.round((totalPredicted - allocatedSum) * 100) / 100;
    } else {
      allocatedSum += predAmt;
    }

    const changeAmt = Math.round((predAmt - item.avg) * 100) / 100;
    const changePct =
      item.avg > 0 ? Math.round(((predAmt - item.avg) / item.avg) * 1000) / 10 : null;
    const sharePct = Math.round(share * 1000) / 10;

    const bAmt = budgetMap.get(item.category) ?? null;
    let budgetVariance: number | null = null;
    let budgetStatus: "under" | "over" | "no_budget" = "no_budget";

    if (bAmt != null) {
      budgetVariance = Math.round((predAmt - bAmt) * 100) / 100;
      budgetStatus = budgetVariance > 0 ? "over" : "under";
    }

    categories.push({
      category: item.category,
      historicalAverage: item.avg,
      predictedAmount: predAmt,
      changeAmount: changeAmt,
      changePercent: changePct,
      shareOfTotal: sharePct,
      categoryBudget: bAmt,
      budgetVariance,
      budgetStatus,
      trend: item.recentTrend,
    });
  }

  // Re-sort categories by predictedAmount desc
  categories.sort((a, b) => b.predictedAmount - a.predictedAmount);

  const highestProjectedCategory = categories[0]?.category ?? null;
  const largestIncreaseCategory =
    [...categories].sort((a, b) => b.changeAmount - a.changeAmount)[0]?.category ?? null;
  const largestDecreaseCategory =
    [...categories].sort((a, b) => a.changeAmount - b.changeAmount)[0]?.category ?? null;

  return {
    targetMonth: mo,
    totalPredicted,
    categories,
    highestProjectedCategory,
    largestIncreaseCategory,
    largestDecreaseCategory,
  };
}

// ---------------------------------------------------------------------------
// Granular Analysis (Daily, Weekly, Monthly spending patterns)
// ---------------------------------------------------------------------------
export interface GranularAnalysis {
  daily: {
    dayOfWeekAverages: {
      day: string;
      dayIndex: number;
      average: number;
      transactionCount: number;
    }[];
    weekdayAverage: number;
    weekendAverage: number;
    peakDay: string;
    lowestDay: string;
    weekendVsWeekdayRatio: number | null;
  };
  weekly: {
    weeklySeries: { weekLabel: string; startDate: string; endDate: string; total: number }[];
    averageWeeklySpend: number;
    highestWeeklySpend: { weekLabel: string; total: number } | null;
    lowestWeeklySpend: { weekLabel: string; total: number } | null;
  };
  monthly: {
    monthlySeries: {
      month: string;
      monthName: string;
      total: number;
      changePercent: number | null;
    }[];
    averageMonthlySpend: number;
    highestMonth: { month: string; total: number } | null;
    lowestMonth: { month: string; total: number } | null;
  };
}

export async function getGranularAnalysis(
  userId?: number,
  referenceDate: Date = new Date(),
): Promise<GranularAnalysis> {
  const txns = await getTransactions({ userId });
  const expenseTxns = txns.filter((t) => t.transactionType === "Expense");
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  // 1. Daily Analysis
  const dayTotals = [0, 0, 0, 0, 0, 0, 0];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];

  for (const t of expenseTxns) {
    const d = new Date(t.transactionDate + "T12:00:00Z");
    const idx = d.getUTCDay();
    dayTotals[idx] += Number(t.amount);
    dayCounts[idx] += 1;
  }

  const dayOfWeekAverages = dayNames.map((day, idx) => ({
    day,
    dayIndex: idx,
    average: dayCounts[idx] > 0 ? Math.round((dayTotals[idx] / dayCounts[idx]) * 100) / 100 : 0,
    transactionCount: dayCounts[idx],
  }));

  const weekdayTotals =
    dayTotals[1] + dayTotals[2] + dayTotals[3] + dayTotals[4] + dayTotals[5];
  const weekdayCount =
    dayCounts[1] + dayCounts[2] + dayCounts[3] + dayCounts[4] + dayCounts[5];
  const weekdayAverage =
    weekdayCount > 0 ? Math.round((weekdayTotals / weekdayCount) * 100) / 100 : 0;

  const weekendTotals = dayTotals[0] + dayTotals[6];
  const weekendCount = dayCounts[0] + dayCounts[6];
  const weekendAverage =
    weekendCount > 0 ? Math.round((weekendTotals / weekendCount) * 100) / 100 : 0;

  const sortedDays = [...dayOfWeekAverages].sort((a, b) => b.average - a.average);
  const peakDay = sortedDays[0]?.average > 0 ? sortedDays[0].day : "None";
  const lowestDay = sortedDays[sortedDays.length - 1]?.day ?? "None";
  const weekendVsWeekdayRatio =
    weekdayAverage > 0 ? Math.round((weekendAverage / weekdayAverage) * 100) / 100 : null;

  // 2. Weekly Analysis
  const sortedTxns = [...expenseTxns].sort((a, b) =>
    a.transactionDate.localeCompare(b.transactionDate),
  );
  const weeklyMap = new Map<string, { startDate: string; endDate: string; total: number }>();

  for (const t of sortedTxns) {
    const d = new Date(t.transactionDate + "T00:00:00Z");
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const weekKey = `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;

    if (!weeklyMap.has(weekKey)) {
      const mon = new Date(d);
      mon.setUTCDate(d.getUTCDate() - 3);
      const sun = new Date(mon);
      sun.setUTCDate(mon.getUTCDate() + 6);
      weeklyMap.set(weekKey, {
        startDate: mon.toISOString().slice(0, 10),
        endDate: sun.toISOString().slice(0, 10),
        total: 0,
      });
    }
    const item = weeklyMap.get(weekKey)!;
    item.total = Math.round((item.total + Number(t.amount)) * 100) / 100;
  }

  const weeklySeries = Array.from(weeklyMap.entries()).map(([k, v]) => ({
    weekLabel: k,
    startDate: v.startDate,
    endDate: v.endDate,
    total: v.total,
  }));

  const totalWeekly = weeklySeries.reduce((s, w) => s + w.total, 0);
  const averageWeeklySpend =
    weeklySeries.length > 0 ? Math.round((totalWeekly / weeklySeries.length) * 100) / 100 : 0;

  const sortedWeeks = [...weeklySeries].sort((a, b) => b.total - a.total);
  const highestWeeklySpend = sortedWeeks[0]
    ? { weekLabel: sortedWeeks[0].weekLabel, total: sortedWeeks[0].total }
    : null;
  const lowestWeeklySpend = sortedWeeks[sortedWeeks.length - 1]
    ? { weekLabel: sortedWeeks[sortedWeeks.length - 1].weekLabel, total: sortedWeeks[sortedWeeks.length - 1].total }
    : null;

  // 3. Monthly Analysis
  const dataset = buildMonthlyExpenseDataset(expenseTxns, referenceDate);
  const monthlySeries: {
    month: string;
    monthName: string;
    total: number;
    changePercent: number | null;
  }[] = [];

  for (let i = 0; i < dataset.monthKeys.length; i++) {
    const k = dataset.monthKeys[i];
    const val = dataset.series[i];
    const [y, m] = k.split("-").map(Number);
    let chgPct: number | null = null;
    if (i > 0 && dataset.series[i - 1] > 0) {
      chgPct =
        Math.round(((val - dataset.series[i - 1]) / dataset.series[i - 1]) * 1000) / 10;
    }
    monthlySeries.push({
      month: k,
      monthName: `${getMonthName(m)} ${y}`,
      total: val,
      changePercent: chgPct,
    });
  }

  const totalMonthly = dataset.series.reduce((a, b) => a + b, 0);
  const averageMonthlySpend =
    dataset.series.length > 0 ? Math.round((totalMonthly / dataset.series.length) * 100) / 100 : 0;

  const sortedMonths = [...monthlySeries].sort((a, b) => b.total - a.total);
  const highestMonth = sortedMonths[0]
    ? { month: sortedMonths[0].month, total: sortedMonths[0].total }
    : null;
  const lowestMonth = sortedMonths[sortedMonths.length - 1]
    ? { month: sortedMonths[sortedMonths.length - 1].month, total: sortedMonths[sortedMonths.length - 1].total }
    : null;

  return {
    daily: {
      dayOfWeekAverages,
      weekdayAverage,
      weekendAverage,
      peakDay,
      lowestDay,
      weekendVsWeekdayRatio,
    },
    weekly: {
      weeklySeries,
      averageWeeklySpend,
      highestWeeklySpend,
      lowestWeeklySpend,
    },
    monthly: {
      monthlySeries,
      averageMonthlySpend,
      highestMonth,
      lowestMonth,
    },
  };
}

// ---------------------------------------------------------------------------
// Explainability ("Why This Prediction?")
// ---------------------------------------------------------------------------
export interface PredictionFactor {
  factor: string;
  description: string;
  impact: "upward" | "downward" | "neutral";
  estimatedImpactAmount?: number;
}

export interface PredictionExplainability {
  targetMonth: string;
  predictedExpense: number;
  baselineExpense: number;
  overallDirection: "increase" | "decrease" | "stable";
  summary: string;
  factors: PredictionFactor[];
  methodDetails: {
    modelType: string;
    lookbackMonths: number;
    trainingDataPoints: number;
    lastEvaluationWape: number | null;
  };
}

export async function getPredictionExplainability(
  userId?: number,
  targetMonth?: string,
  referenceDate: Date = new Date(),
): Promise<PredictionExplainability> {
  const personalized = await getPersonalizedForecast(userId, referenceDate);
  const target = targetMonth ?? personalized.targetMonth;
  const predVal = personalized.predictedExpense ?? 0;
  const baseline = personalized.previousMonthExpense ?? predVal;
  const diff = Math.round((predVal - baseline) * 100) / 100;
  const overallDirection = diff > 50 ? "increase" : diff < -50 ? "decrease" : "stable";

  const [ty, tm] = target.split("-").map(Number);
  const targetMonthName = `${getMonthName(tm)} ${ty}`;
  const targetDays = getDaysInMonth(ty, tm);

  const prevKey = addMonths(target, -1);
  const [py, pm] = prevKey.split("-").map(Number);
  const prevMonthName = `${getMonthName(pm)} ${py}`;
  const prevDays = getDaysInMonth(py, pm);

  const factors: PredictionFactor[] = [];

  // 1. Baseline driver
  factors.push({
    factor: "Historical Baseline Level",
    description: `Anchored to your historical baseline of ₹${baseline.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
    })} across ${personalized.monthsCount} recorded month(s).`,
    impact: "neutral",
  });

  // 2. Spending Velocity
  if (personalized.changePercent != null && Math.abs(personalized.changePercent) > 0.5) {
    factors.push({
      factor: "Recent Spending Velocity",
      description: `Reflects a ${personalized.changePercent > 0 ? "+" : ""}${personalized.changePercent}% velocity shift compared to ${prevMonthName}.`,
      impact: personalized.changePercent > 0 ? "upward" : "downward",
      estimatedImpactAmount: Math.abs(diff),
    });
  }

  // 3. Top Category Driver
  const catForecast = await getCategoryForecasts(userId, target, referenceDate);
  if (catForecast.categories.length > 0) {
    const topCat = catForecast.categories[0];
    factors.push({
      factor: `Category Driver: ${topCat.category}`,
      description: `${topCat.category} forms the largest projected expenditure (₹${topCat.predictedAmount.toLocaleString(
        "en-IN",
        { minimumFractionDigits: 2 },
      )}, ${topCat.shareOfTotal}% share) with ${topCat.trend} recent momentum.`,
      impact:
        topCat.trend === "increasing"
          ? "upward"
          : topCat.trend === "decreasing"
          ? "downward"
          : "neutral",
    });
  }

  // 4. Calendar effect
  if (targetDays !== prevDays) {
    factors.push({
      factor: "Calendar Days Effect",
      description: `${targetMonthName} has ${targetDays} days (${
        targetDays > prevDays ? "1 day more" : "fewer days"
      } than ${prevMonthName} with ${prevDays} days), affecting daily spend run-rates.`,
      impact: targetDays > prevDays ? "upward" : "downward",
    });
  }

  // 5. Model Architecture
  factors.push({
    factor: "Forecasting Engine",
    description: `${personalized.method} applying ${
      personalized.status === "ready"
        ? "LSTM neural network weights"
        : "chronological moving average baseline"
    } without external data leakage.`,
    impact: "neutral",
  });

  const summary =
    predVal > 0
      ? `The projected expense for ${targetMonthName} is ₹${predVal.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
        })}, representing a ${
          Math.abs(diff) < 50
            ? "stable"
            : overallDirection === "increase"
            ? "projected rise"
            : "projected reduction"
        } (${
          personalized.changePercent != null
            ? (personalized.changePercent > 0 ? "+" : "") +
              personalized.changePercent +
              "%"
            : "0%"
        }) relative to ${prevMonthName}. Primary factors include ${
          factors[1]?.factor ?? factors[0].factor
        } and category spending trends.`
      : "No personal expense data available to formulate an explainable forecast.";

  return {
    targetMonth: target,
    predictedExpense: predVal,
    baselineExpense: baseline,
    overallDirection,
    summary,
    factors,
    methodDetails: {
      modelType: personalized.method,
      lookbackMonths: personalized.requiredMonths,
      trainingDataPoints: personalized.monthsCount,
      lastEvaluationWape: personalized.evaluationMetrics?.wape ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// "What-If" Spending Simulator
// ---------------------------------------------------------------------------
export interface ScenarioInput {
  categoryAdjustments?: { [category: string]: number };
  oneOffExpenses?: { name: string; amount: number; category?: string }[];
}

export interface ScenarioSimulationResult {
  baselineForecast: number;
  simulatedForecast: number;
  netDifference: number;
  percentChange: number;
  overallBudget: number | null;
  baselineBudgetDifference: number | null;
  simulatedBudgetDifference: number | null;
  budgetStatusBefore: "under" | "over" | "no_budget";
  budgetStatusAfter: "under" | "over" | "no_budget";
  categoryBreakdown: {
    category: string;
    baselineAmount: number;
    adjustmentPercent: number;
    adjustedAmount: number;
    oneOffAmount: number;
    simulatedTotal: number;
    categoryBudget: number | null;
    categoryBudgetDifference: number | null;
  }[];
  oneOffTotal: number;
}

export async function simulateSpendingScenario(
  userId?: number,
  input: ScenarioInput = {},
  referenceDate: Date = new Date(),
): Promise<ScenarioSimulationResult> {
  const catForecast = await getCategoryForecasts(userId, undefined, referenceDate);
  const personalized = await getPersonalizedForecast(userId, referenceDate);
  const baselineForecast = personalized.predictedExpense ?? 0;
  const overallBudget = personalized.budgetComparison?.budget ?? null;

  const categoryBreakdown: ScenarioSimulationResult["categoryBreakdown"] = [];
  let runningSimulatedTotal = 0;

  const adjMap = input.categoryAdjustments ?? {};
  const oneOffs = input.oneOffExpenses ?? [];

  for (const cat of catForecast.categories) {
    const adjPct = adjMap[cat.category] ?? 0;
    const adjustedAmount = Math.round(cat.predictedAmount * (1 + adjPct / 100) * 100) / 100;

    const catOneOffs = oneOffs
      .filter((o) => o.category === cat.category)
      .reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

    const simulatedTotal = Math.round((adjustedAmount + catOneOffs) * 100) / 100;
    runningSimulatedTotal += simulatedTotal;

    const catBudget = cat.categoryBudget;
    const catDiff =
      catBudget != null ? Math.round((simulatedTotal - catBudget) * 100) / 100 : null;

    categoryBreakdown.push({
      category: cat.category,
      baselineAmount: cat.predictedAmount,
      adjustmentPercent: adjPct,
      adjustedAmount,
      oneOffAmount: catOneOffs,
      simulatedTotal,
      categoryBudget: catBudget,
      categoryBudgetDifference: catDiff,
    });
  }

  // Uncategorized one-off expenses
  const uncatOneOffs = oneOffs
    .filter(
      (o) =>
        !o.category || !catForecast.categories.some((c) => c.category === o.category),
    )
    .reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

  const oneOffTotal = oneOffs.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  const simulatedForecast = Math.round((runningSimulatedTotal + uncatOneOffs) * 100) / 100;
  const netDifference = Math.round((simulatedForecast - baselineForecast) * 100) / 100;
  const percentChange =
    baselineForecast > 0
      ? Math.round((netDifference / baselineForecast) * 1000) / 10
      : 0;

  const baselineBudgetDiff =
    overallBudget != null
      ? Math.round((baselineForecast - overallBudget) * 100) / 100
      : null;
  const simulatedBudgetDiff =
    overallBudget != null
      ? Math.round((simulatedForecast - overallBudget) * 100) / 100
      : null;

  return {
    baselineForecast,
    simulatedForecast,
    netDifference,
    percentChange,
    overallBudget,
    baselineBudgetDifference: baselineBudgetDiff,
    simulatedBudgetDifference: simulatedBudgetDiff,
    budgetStatusBefore:
      overallBudget != null
        ? baselineForecast > overallBudget
          ? "over"
          : "under"
        : "no_budget",
    budgetStatusAfter:
      overallBudget != null
        ? simulatedForecast > overallBudget
          ? "over"
          : "under"
        : "no_budget",
    categoryBreakdown,
    oneOffTotal,
  };
}

// ---------------------------------------------------------------------------
// Prediction History & Performance Tracking
// ---------------------------------------------------------------------------
export interface HistoricalPredictionEvaluation {
  id: number;
  targetMonth: string;
  predictedExpense: number;
  actualExpense: number | null;
  difference: number | null;
  absoluteError: number | null;
  percentageError: number | null;
  accuracyRating: "Accurate" | "Moderate" | "Divergent" | "Pending Realization";
  status: "completed" | "in_progress" | "future";
  modelVersion: string;
  createdAt: string;
}

export interface PredictionHistorySummary {
  records: HistoricalPredictionEvaluation[];
  completedCount: number;
  meanAbsoluteError: number | null;
  averagePercentageAccuracy: number | null;
  overallRating: string;
}

export async function getPredictionHistory(
  userId?: number,
  referenceDate: Date = new Date(),
): Promise<PredictionHistorySummary> {
  const currentMonth = normalizeMonthKey(referenceDate);
  const userCond = userId != null ? eq(predictions.userId, userId) : undefined;

  const rows = await db
    .select()
    .from(predictions)
    .where(userCond)
    .orderBy(desc(predictions.targetMonth));

  const txns = await getTransactions({ userId });
  const expenseTxns = txns.filter((t) => t.transactionType === "Expense");

  const monthlyTotals = new Map<string, number>();
  for (const t of expenseTxns) {
    const mo = t.transactionDate.slice(0, 7);
    monthlyTotals.set(
      mo,
      Math.round(((monthlyTotals.get(mo) ?? 0) + Number(t.amount)) * 100) / 100,
    );
  }

  const records: HistoricalPredictionEvaluation[] = [];
  let completedAbsErrSum = 0;
  let completedAccuracySum = 0;
  let completedCount = 0;

  for (const r of rows) {
    const predVal = Number(r.predictedExpense);
    const mo = r.targetMonth;
    let actual: number | null = null;
    let diff: number | null = null;
    let absErr: number | null = null;
    let pctErr: number | null = null;
    let rating: HistoricalPredictionEvaluation["accuracyRating"] = "Pending Realization";
    let st: HistoricalPredictionEvaluation["status"] = "future";

    if (mo < currentMonth) {
      st = "completed";
      actual = monthlyTotals.get(mo) ?? 0;
      diff = Math.round((predVal - actual) * 100) / 100;
      absErr = Math.abs(diff);
      pctErr = actual > 0 ? Math.round((absErr / actual) * 1000) / 10 : 0;
      rating = pctErr <= 10 ? "Accurate" : pctErr <= 25 ? "Moderate" : "Divergent";

      completedCount += 1;
      completedAbsErrSum += absErr;
      const acc = Math.max(0, 100 - pctErr);
      completedAccuracySum += acc;
    } else if (mo === currentMonth) {
      st = "in_progress";
      actual = monthlyTotals.get(mo) ?? 0;
      diff = Math.round((predVal - actual) * 100) / 100;
      absErr = Math.abs(diff);
      rating = "Pending Realization";
    } else {
      st = "future";
      rating = "Pending Realization";
    }

    records.push({
      id: r.id,
      targetMonth: mo,
      predictedExpense: predVal,
      actualExpense: actual,
      difference: diff,
      absoluteError: absErr,
      percentageError: pctErr,
      accuracyRating: rating,
      status: st,
      modelVersion: r.modelVersion,
      createdAt: r.createdAt.toISOString(),
    });
  }

  const meanAbsoluteError =
    completedCount > 0
      ? Math.round((completedAbsErrSum / completedCount) * 100) / 100
      : null;
  const averagePercentageAccuracy =
    completedCount > 0
      ? Math.round((completedAccuracySum / completedCount) * 10) / 10
      : null;

  let overallRating = "No Completed Predictions";
  if (completedCount > 0 && averagePercentageAccuracy != null) {
    if (averagePercentageAccuracy >= 85) overallRating = "High Historical Accuracy";
    else if (averagePercentageAccuracy >= 70) overallRating = "Moderate Historical Accuracy";
    else overallRating = "Divergent / Calibrating";
  }

  return {
    records,
    completedCount,
    meanAbsoluteError,
    averagePercentageAccuracy,
    overallRating,
  };
}

export async function savePredictionRecord(
  userId?: number,
  targetMonth?: string,
  amount?: number,
  modelVersion?: string,
): Promise<void> {
  if (!targetMonth || amount == null) return;
  const deleteCondition =
    userId != null
      ? and(eq(predictions.targetMonth, targetMonth), eq(predictions.userId, userId))
      : eq(predictions.targetMonth, targetMonth);

  await db.delete(predictions).where(deleteCondition);
  await db.insert(predictions).values({
    userId: userId ?? null,
    targetMonth,
    predictedExpense: String(Math.round(amount * 100) / 100),
    modelVersion: modelVersion ?? "lstm-v1",
  });
}

