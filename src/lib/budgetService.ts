import { db } from "@/db";
import { budgets, type BudgetRow } from "@/db/schema";
import { and, eq, isNull, inArray } from "drizzle-orm";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  getDaysInMonth,
  normalizeMonthKey,
  parseMonthKey,
  addMonths,
} from "./config";
import type { Budget, BudgetInput } from "./types";
import { getTransactions } from "./transactionService";

function toNumber(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : Number(n) || 0;
}

export function rowToBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    userId: row.userId,
    month: row.month,
    category: row.category,
    budgetAmount: toNumber(row.budgetAmount),
    name: row.name ?? null,
    notes: row.notes ?? null,
    alertThreshold: row.alertThreshold ?? 80,
    status: (row.status as any) ?? "active",
    periodType: (row.periodType as any) ?? "monthly",
    startDate: row.startDate ?? null,
    endDate: row.endDate ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
  };
}

export async function createBudget(
  input: BudgetInput,
  userId?: number,
): Promise<Budget> {
  if (!input.month || !/^\d{4}-\d{2}$/.test(input.month)) {
    throw new Error("Month must be YYYY-MM.");
  }
  const amount = Number(input.budgetAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Budget amount must be positive.");
  }

  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    throw new Error("Start date cannot be after end date.");
  }

  const effectiveUserId = userId ?? input.userId ?? null;

  const conditions = [
    eq(budgets.month, input.month),
    input.category ? eq(budgets.category, input.category) : isNull(budgets.category),
  ];
  if (effectiveUserId != null) {
    conditions.push(eq(budgets.userId, effectiveUserId));
  } else {
    conditions.push(isNull(budgets.userId));
  }

  const existing = await db
    .select()
    .from(budgets)
    .where(and(...conditions))
    .limit(1);

  if (existing.length) {
    const [row] = await db
      .update(budgets)
      .set({
        budgetAmount: String(amount),
        name: input.name !== undefined ? input.name : existing[0].name,
        notes: input.notes !== undefined ? input.notes : existing[0].notes,
        alertThreshold:
          input.alertThreshold !== undefined
            ? input.alertThreshold
            : existing[0].alertThreshold,
        status: input.status !== undefined ? input.status : existing[0].status,
        periodType:
          input.periodType !== undefined
            ? input.periodType
            : existing[0].periodType,
        startDate:
          input.startDate !== undefined
            ? input.startDate
            : existing[0].startDate,
        endDate:
          input.endDate !== undefined ? input.endDate : existing[0].endDate,
        updatedAt: new Date(),
      })
      .where(eq(budgets.id, existing[0].id))
      .returning();
    return rowToBudget(row);
  }

  const [row] = await db
    .insert(budgets)
    .values({
      userId: effectiveUserId,
      month: input.month,
      category: input.category ?? null,
      budgetAmount: String(amount),
      name: input.name ?? null,
      notes: input.notes ?? null,
      alertThreshold: input.alertThreshold ?? 80,
      status: input.status ?? "active",
      periodType: input.periodType ?? "monthly",
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      updatedAt: new Date(),
    })
    .returning();
  return rowToBudget(row);
}

export async function updateBudget(
  id: number,
  input: Partial<BudgetInput>,
  userId?: number,
): Promise<Budget> {
  const existing = await getBudget(id, userId);
  if (!existing) {
    throw new Error("Budget not found or access denied.");
  }

  const updateFields: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.budgetAmount !== undefined) {
    const amt = Number(input.budgetAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new Error("Budget amount must be positive.");
    }
    updateFields.budgetAmount = String(amt);
  }
  if (input.name !== undefined) updateFields.name = input.name;
  if (input.notes !== undefined) updateFields.notes = input.notes;
  if (input.alertThreshold !== undefined)
    updateFields.alertThreshold = input.alertThreshold;
  if (input.status !== undefined) updateFields.status = input.status;
  if (input.periodType !== undefined) updateFields.periodType = input.periodType;
  if (input.startDate !== undefined) updateFields.startDate = input.startDate;
  if (input.endDate !== undefined) updateFields.endDate = input.endDate;

  const [row] = await db
    .update(budgets)
    .set(updateFields)
    .where(eq(budgets.id, id))
    .returning();
  return rowToBudget(row);
}

export async function duplicateBudgets(
  fromMonth: string,
  toMonth: string,
  userId?: number,
): Promise<Budget[]> {
  if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth)) {
    throw new Error("Months must be YYYY-MM.");
  }
  const sourceBudgets = await getBudgets(fromMonth, userId);
  const activeSources = sourceBudgets.filter((b) => b.status !== "archived");
  const created: Budget[] = [];

  for (const b of activeSources) {
    const res = await createBudget(
      {
        month: toMonth,
        category: b.category,
        budgetAmount: b.budgetAmount,
        name: b.name,
        notes: b.notes ? `Copied from ${fromMonth}` : null,
        alertThreshold: b.alertThreshold,
        status: "active",
        periodType: b.periodType,
      },
      userId,
    );
    created.push(res);
  }
  return created;
}

export async function getBudgets(
  month?: string,
  userId?: number,
  status?: string,
): Promise<Budget[]> {
  const conditions = [];
  if (month) conditions.push(eq(budgets.month, month));
  if (userId != null) conditions.push(eq(budgets.userId, userId));
  if (status) conditions.push(eq(budgets.status, status));

  const rows = conditions.length
    ? await db.select().from(budgets).where(and(...conditions))
    : await db.select().from(budgets);
  return rows.map(rowToBudget);
}

export async function getBudget(
  id: number,
  userId?: number,
): Promise<Budget | null> {
  const condition =
    userId != null
      ? and(eq(budgets.id, id), eq(budgets.userId, userId))
      : eq(budgets.id, id);

  const [row] = await db.select().from(budgets).where(condition);
  return row ? rowToBudget(row) : null;
}

export async function deleteBudget(
  id: number,
  userId?: number,
): Promise<void> {
  const condition =
    userId != null
      ? and(eq(budgets.id, id), eq(budgets.userId, userId))
      : eq(budgets.id, id);

  await db.delete(budgets).where(condition);
}

export async function clearBudgets(userId?: number): Promise<void> {
  if (userId != null) {
    await db.delete(budgets).where(eq(budgets.userId, userId));
  } else {
    await db.delete(budgets);
  }
}

// ---------------------------------------------------------------------------
// Intelligence & Evaluation Interfaces
// ---------------------------------------------------------------------------

export interface BudgetWarning {
  level: "ok" | "warning" | "exceeded" | "forecast";
  message: string;
  category?: string;
  currentSpend?: number;
  budgetLimit?: number;
  remainingOrOverspend?: number;
  recommendedAction?: string;
}

export interface CategoryBudgetRow {
  category: string;
  budget: number | null;
  actual: number;
  remaining: number | null;
  utilization: number | null;
  dailyAvg?: number;
  projected?: number | null;
  status: "On Track" | "Caution" | "Near Limit" | "Over Budget" | "Unbudgeted";
  previousPeriodActual?: number;
}

export interface BudgetRecommendation {
  id: string;
  type:
    | "reduce_high_spend"
    | "adjust_unrealistic"
    | "slow_down"
    | "reallocate"
    | "next_month_plan";
  title: string;
  supportingData: string;
  reason: string;
  suggestedAction: string;
  estimatedImpact: string;
  relevantCategory?: string;
}

export interface BudgetStatus {
  month: string;
  overallBudget: number | null;
  actualExpenses: number;
  remaining: number | null; // overallBudget - actual
  utilization: number | null; // % of overall
  projectedPeriodEnd: number;
  projectedOverspend: number;
  dailyBurnRate: number;
  allowableDailyRemaining: number;
  projectedExhaustionDate: string | null;
  daysElapsed: number;
  totalDaysInMonth: number;
  categoriesOverBudget: number;
  categoriesNearLimit: number;
  warnings: BudgetWarning[];
  recommendations: BudgetRecommendation[];
  categoryBreakdown: CategoryBudgetRow[];
  hasCategoryBudgets: boolean;
  unallocatedReserve: number | null;
  lstmForecast?: {
    predictedExpense: number | null;
    method: string;
    explanation: string;
    varianceVsBudget?: number | null;
  } | null;
}

// Pure budget evaluation (no DB access) — used directly by unit tests & server routes.
export function evaluateBudget(input: {
  month: string;
  overallBudget: number | null;
  categoryBudgets: { category: string; budget: number; alertThreshold?: number }[];
  actualByCategory: Record<string, number>;
  totalActual: number;
  threshold: number;
  referenceDate?: Date;
  previousActualByCategory?: Record<string, number>;
  lstmForecast?: {
    predictedExpense: number | null;
    method: string;
    explanation: string;
  } | null;
}): BudgetStatus {
  const {
    month,
    overallBudget,
    categoryBudgets,
    actualByCategory,
    totalActual,
    threshold,
    referenceDate = new Date(),
    previousActualByCategory = {},
    lstmForecast = null,
  } = input;

  const actual = totalActual;
  let remaining: number | null = null;
  let utilization: number | null = null;
  const warnings: BudgetWarning[] = [];

  const { year, month: monthNum } = parseMonthKey(month);
  const totalDaysInMonth = getDaysInMonth(year, monthNum);

  const currentMonthStr = normalizeMonthKey(referenceDate);
  const isCurrentMonth = month === currentMonthStr;
  const isPastMonth = month < currentMonthStr;

  const daysElapsed = isCurrentMonth
    ? Math.max(1, Math.min(totalDaysInMonth, referenceDate.getDate()))
    : isPastMonth
    ? totalDaysInMonth
    : 0;
  const remainingDays = isCurrentMonth
    ? Math.max(0, totalDaysInMonth - daysElapsed)
    : 0;

  const dailyBurnRate = daysElapsed > 0 ? actual / daysElapsed : 0;
  const projectedPeriodEnd = isCurrentMonth
    ? actual + dailyBurnRate * remainingDays
    : isPastMonth
    ? actual
    : 0;

  let projectedOverspend = 0;
  let projectedExhaustionDate: string | null = null;

  if (overallBudget !== null) {
    remaining = overallBudget - actual;
    utilization =
      overallBudget > 0
        ? Math.round(((actual / overallBudget) * 100) * 100) / 100
        : 0;
    projectedOverspend = Math.max(0, projectedPeriodEnd - overallBudget);

    if (actual > overallBudget) {
      warnings.push({
        level: "exceeded",
        message: `Overall budget exceeded by ${(actual - overallBudget).toFixed(2)}.`,
        budgetLimit: overallBudget,
        currentSpend: actual,
        remainingOrOverspend: actual - overallBudget,
        recommendedAction:
          "Immediate pause on all non-essential and discretionary outlays recommended.",
      });
    } else if (utilization >= threshold) {
      warnings.push({
        level: "warning",
        message: `Approaching overall budget: ${utilization.toFixed(1)}% used (>= ${threshold}% threshold).`,
        budgetLimit: overallBudget,
        currentSpend: actual,
        remainingOrOverspend: remaining,
        recommendedAction:
          "You have consumed over your set safety buffer. Prioritize essential commitments only.",
      });
    } else {
      warnings.push({
        level: "ok",
        message: `Overall budget healthy: ${utilization.toFixed(1)}% used.`,
        budgetLimit: overallBudget,
        currentSpend: actual,
        remainingOrOverspend: remaining,
        recommendedAction: "Spending is currently well disciplined and on track.",
      });
    }

    // Burn rate & projected exhaustion warning
    if (
      isCurrentMonth &&
      projectedPeriodEnd > overallBudget &&
      actual <= overallBudget &&
      dailyBurnRate > 0
    ) {
      const exhaustionDay = Math.min(
        totalDaysInMonth,
        Math.ceil(overallBudget / dailyBurnRate),
      );
      projectedExhaustionDate = `${month}-${String(exhaustionDay).padStart(2, "0")}`;
      warnings.push({
        level: "forecast",
        message: `At your current burn rate (₹${dailyBurnRate.toFixed(2)}/day), budget exhaustion is projected on ${projectedExhaustionDate}. Total projected month-end outlay: ₹${projectedPeriodEnd.toFixed(2)}.`,
        budgetLimit: overallBudget,
        currentSpend: actual,
        remainingOrOverspend: projectedOverspend,
        recommendedAction: `Restrict spending to ₹${(
          Math.max(0, remaining) / Math.max(1, remainingDays)
        ).toFixed(2)}/day for the remaining ${remainingDays} days to remain within budget.`,
      });
    }
  }

  const allowableDailyRemaining =
    isCurrentMonth && remainingDays > 0 && remaining !== null
      ? Math.max(0, remaining) / remainingDays
      : 0;

  // Process Category Breakdown
  const categoryBreakdown: CategoryBudgetRow[] = categoryBudgets.map((b) => {
    const catActual = actualByCategory[b.category] ?? 0;
    const catRemaining = b.budget - catActual;
    const catUtil = b.budget > 0 ? (catActual / b.budget) * 100 : 0;
    const catDailyAvg = daysElapsed > 0 ? catActual / daysElapsed : 0;
    const catProjected = isCurrentMonth
      ? catActual + catDailyAvg * remainingDays
      : catActual;
    const catThreshold = b.alertThreshold ?? threshold;
    const prevActual = previousActualByCategory[b.category];

    let status: CategoryBudgetRow["status"] = "On Track";
    if (catActual > b.budget) {
      status = "Over Budget";
      warnings.push({
        level: "exceeded",
        category: b.category,
        message: `Category '${b.category}' budget exceeded by ${(
          catActual - b.budget
        ).toFixed(2)}.`,
        budgetLimit: b.budget,
        currentSpend: catActual,
        remainingOrOverspend: catActual - b.budget,
        recommendedAction: `Review recent transactions in ${b.category} and postpone further discretionary purchases.`,
      });
    } else if (catUtil >= catThreshold) {
      status = "Near Limit";
      warnings.push({
        level: "warning",
        category: b.category,
        message: `Category '${b.category}' nearing budget (${catUtil.toFixed(1)}% used).`,
        budgetLimit: b.budget,
        currentSpend: catActual,
        remainingOrOverspend: catRemaining,
        recommendedAction: `Remaining budget for ${b.category} is ₹${catRemaining.toFixed(2)}. Exercise caution.`,
      });
    } else if (catUtil >= 50 || (isCurrentMonth && catProjected > b.budget)) {
      status = "Caution";
    }

    return {
      category: b.category,
      budget: b.budget,
      actual: catActual,
      remaining: catRemaining,
      utilization: catUtil,
      dailyAvg: Math.round(catDailyAvg * 100) / 100,
      projected: Math.round(catProjected * 100) / 100,
      status,
      previousPeriodActual: prevActual,
    };
  });

  // Check for categories with actual spending but no allocated budget
  const budgetedCategorySet = new Set(categoryBudgets.map((b) => b.category));
  for (const [catName, catSpend] of Object.entries(actualByCategory)) {
    if (!budgetedCategorySet.has(catName) && catSpend > 0) {
      categoryBreakdown.push({
        category: catName,
        budget: null,
        actual: catSpend,
        remaining: null,
        utilization: null,
        dailyAvg: daysElapsed > 0 ? Math.round((catSpend / daysElapsed) * 100) / 100 : 0,
        projected: isCurrentMonth
          ? Math.round((catSpend + (catSpend / Math.max(1, daysElapsed)) * remainingDays) * 100) / 100
          : catSpend,
        status: "Unbudgeted",
        previousPeriodActual: previousActualByCategory[catName],
      });
    }
  }

  // Count categories
  const categoriesOverBudget = categoryBreakdown.filter(
    (c) => c.status === "Over Budget",
  ).length;
  const categoriesNearLimit = categoryBreakdown.filter(
    (c) => c.status === "Near Limit",
  ).length;

  // Unallocated reserve calculation
  const totalCategoryBudgetSum = categoryBudgets.reduce(
    (acc, b) => acc + b.budget,
    0,
  );
  const unallocatedReserve =
    overallBudget !== null
      ? Math.max(0, overallBudget - totalCategoryBudgetSum)
      : null;

  // Generate Intelligent Budget Recommendations
  const recommendations: BudgetRecommendation[] = [];

  // 1. Reduce High Spending Category
  if (actual > 0) {
    const sortedCats = [...categoryBreakdown]
      .filter((c) => c.actual > 0)
      .sort((a, b) => b.actual - a.actual);
    if (sortedCats.length > 0) {
      const topCat = sortedCats[0];
      const topShare = (topCat.actual / actual) * 100;
      if (topShare >= 30) {
        recommendations.push({
          id: `rec-high-spend-${topCat.category}`,
          type: "reduce_high_spend",
          title: `Curtail High Spending in ${topCat.category}`,
          supportingData: `${topCat.category} accounts for ₹${topCat.actual.toFixed(2)} (${topShare.toFixed(1)}% of your monthly expenditure).`,
          reason: `Disproportionate concentration in a single category creates severe budget vulnerability.`,
          suggestedAction: `Target a 15% reduction in ${topCat.category} over the remainder of the period to free up capital.`,
          estimatedImpact: `Estimated potential monthly savings of ₹${(topCat.actual * 0.15).toFixed(2)}.`,
          relevantCategory: topCat.category,
        });
      }
    }
  }

  // 2. Adjust Unrealistic Budget
  const repeatedExceeders = categoryBreakdown.filter(
    (c) => c.budget !== null && c.actual > c.budget && c.utilization !== null && c.utilization >= 115,
  );
  for (const exc of repeatedExceeders.slice(0, 2)) {
    const suggestedTarget = Math.round((exc.actual * 1.05) / 100) * 100;
    recommendations.push({
      id: `rec-unrealistic-${exc.category}`,
      type: "adjust_unrealistic",
      title: `Recalibrate Unrealistic Budget for ${exc.category}`,
      supportingData: `Allocated limit was ₹${exc.budget?.toFixed(2)}, but actual spending reached ₹${exc.actual.toFixed(2)} (${exc.utilization?.toFixed(1)}%).`,
      reason: `Setting an excessively rigid cap that is consistently breached leads to budget fatigue.`,
      suggestedAction: `Increase the ${exc.category} allocation to ₹${suggestedTarget.toFixed(2)} based on recent verified consumption patterns.`,
      estimatedImpact: `Aligns budget expectations with reality, eliminating artificial overspending flags.`,
      relevantCategory: exc.category,
    });
  }

  // 3. Slow Down Spending
  if (isCurrentMonth && projectedPeriodEnd > (overallBudget ?? actual) && allowableDailyRemaining > 0) {
    recommendations.push({
      id: "rec-slow-down",
      type: "slow_down",
      title: `Regulate Daily Spending Pace`,
      supportingData: `Current daily run rate is ₹${dailyBurnRate.toFixed(2)}/day across ${daysElapsed} elapsed days.`,
      reason: `If this velocity continues, spending will outpace your allocation before month-end.`,
      suggestedAction: `Cap total daily expenses at ₹${allowableDailyRemaining.toFixed(2)} for the remaining ${remainingDays} days.`,
      estimatedImpact: `Prevents projected overspending of ₹${projectedOverspend.toFixed(2)}.`,
    });
  }

  // 4. Reallocate Unused Budget
  const surplusCategories = categoryBreakdown.filter(
    (c) => c.budget !== null && c.budget > 1000 && c.remaining !== null && c.remaining > 500 && (c.utilization ?? 0) < 50,
  );
  const strainedCategories = categoryBreakdown.filter(
    (c) => c.status === "Over Budget" || c.status === "Near Limit",
  );
  if (surplusCategories.length > 0 && strainedCategories.length > 0) {
    const donor = surplusCategories[0];
    const receiver = strainedCategories[0];
    const reallocAmt = Math.min(donor.remaining ?? 0, 1000);
    recommendations.push({
      id: `rec-reallocate-${donor.category}-${receiver.category}`,
      type: "reallocate",
      title: `Reallocate Surplus from ${donor.category} to ${receiver.category}`,
      supportingData: `${donor.category} has an unutilized surplus of ₹${donor.remaining?.toFixed(2)}, while ${receiver.category} is strained at ${receiver.utilization?.toFixed(1)}% utilization.`,
      reason: `Balancing surpluses across categories prevents overall deficit without requiring new funds.`,
      suggestedAction: `Review and adjust budget limits: transfer ₹${reallocAmt.toFixed(2)} allocation from ${donor.category} to ${receiver.category}.`,
      estimatedImpact: `Relieves spending pressure on ${receiver.category} and improves budget adherence.`,
      relevantCategory: receiver.category,
    });
  }

  // 5. Future Month Planning
  if (isCurrentMonth) {
    const nextMonthKey = addMonths(month, 1);
    const suggestedNextLimit = Math.round((actual * 1.05) / 500) * 500;
    recommendations.push({
      id: "rec-next-month",
      type: "next_month_plan",
      title: `Plan Initial Budget for ${nextMonthKey}`,
      supportingData: `Current month-to-date spending stands at ₹${actual.toFixed(2)}.`,
      reason: `Proactive planning before the new month starts prevents unmonitored spending in the first week.`,
      suggestedAction: `Use the Budget Planning Wizard to set an initial cap of ₹${suggestedNextLimit.toFixed(2)} for ${nextMonthKey}.`,
      estimatedImpact: `Establishes early financial boundaries and automated alert monitoring from day 1.`,
    });
  }

  // LSTM Deep Learning forecast comparison
  let enrichedLstmForecast = null;
  if (lstmForecast && lstmForecast.predictedExpense !== null) {
    const varianceVsBudget =
      overallBudget !== null
        ? Math.round((lstmForecast.predictedExpense - overallBudget) * 100) / 100
        : null;
    enrichedLstmForecast = {
      predictedExpense: lstmForecast.predictedExpense,
      method: lstmForecast.method,
      explanation: lstmForecast.explanation,
      varianceVsBudget,
    };
  }

  return {
    month,
    overallBudget,
    actualExpenses: actual,
    remaining,
    utilization,
    projectedPeriodEnd: Math.round(projectedPeriodEnd * 100) / 100,
    projectedOverspend: Math.round(projectedOverspend * 100) / 100,
    dailyBurnRate: Math.round(dailyBurnRate * 100) / 100,
    allowableDailyRemaining: Math.round(allowableDailyRemaining * 100) / 100,
    projectedExhaustionDate,
    daysElapsed,
    totalDaysInMonth,
    categoriesOverBudget,
    categoriesNearLimit,
    warnings,
    recommendations,
    categoryBreakdown,
    hasCategoryBudgets: categoryBudgets.length > 0,
    unallocatedReserve,
    lstmForecast: enrichedLstmForecast,
  };
}

export async function computeBudgetStatus(
  month: string,
  actualByCategory: Record<string, number>,
  totalActual: number,
  settings?: Pick<AppSettings, "warningThreshold">,
  userId?: number,
  referenceDate?: Date,
  previousActualByCategory?: Record<string, number>,
): Promise<BudgetStatus> {
  const threshold =
    settings?.warningThreshold ?? DEFAULT_SETTINGS.warningThreshold;
  const all = await getBudgets(month, userId);
  const activeBudgets = all.filter((b) => b.status !== "archived");
  const overall = activeBudgets.find(
    (b) => b.category === null || b.category === "",
  );
  const categoryBudgets = activeBudgets
    .filter((b) => b.category !== null && b.category !== "")
    .map((b) => ({
      category: b.category as string,
      budget: b.budgetAmount,
      alertThreshold: b.alertThreshold ?? undefined,
    }));

  // Fetch previous month transactions if not provided
  let prevCatActual = previousActualByCategory;
  if (!prevCatActual) {
    const prevMonth = addMonths(month, -1);
    const txns = await getTransactions({ userId });
    const prevTxns = txns.filter(
      (t) =>
        t.transactionType === "Expense" &&
        normalizeMonthKey(t.transactionDate) === prevMonth,
    );
    prevCatActual = {};
    for (const t of prevTxns) {
      prevCatActual[t.category] =
        (prevCatActual[t.category] ?? 0) + Number(t.amount);
    }
  }

  return evaluateBudget({
    month,
    overallBudget: overall ? overall.budgetAmount : null,
    categoryBudgets,
    actualByCategory,
    totalActual,
    threshold,
    referenceDate,
    previousActualByCategory: prevCatActual,
  });
}

// ---------------------------------------------------------------------------
// Historical Budget Performance Service
// ---------------------------------------------------------------------------

export interface MonthBudgetHistory {
  month: string;
  overallBudget: number | null;
  actualExpenses: number;
  remaining: number | null;
  utilization: number | null;
  status: "on_track" | "warning" | "exceeded" | "unbudgeted";
  categoriesOverBudgetCount: number;
}

export interface BudgetHistorySummary {
  history: MonthBudgetHistory[];
  repeatedOverspendingCategories: { category: string; occurrences: number }[];
  consistentlyUnusedCategories: { category: string; averageUtilization: number }[];
  overallAdherenceRate: number; // percentage of months on track
}

export async function getBudgetHistory(
  userId?: number,
  monthsCount = 6,
): Promise<BudgetHistorySummary> {
  const txns = await getTransactions({ userId });
  const allBudgets = await getBudgets(undefined, userId);

  // Group expense transactions by month and category
  const expenseTxns = txns.filter((t) => t.transactionType === "Expense");
  const monthlyTotals: Record<string, number> = {};
  const monthlyCategoryTotals: Record<string, Record<string, number>> = {};

  for (const t of expenseTxns) {
    const m = normalizeMonthKey(t.transactionDate);
    monthlyTotals[m] = (monthlyTotals[m] ?? 0) + Number(t.amount);
    if (!monthlyCategoryTotals[m]) monthlyCategoryTotals[m] = {};
    monthlyCategoryTotals[m][t.category] =
      (monthlyCategoryTotals[m][t.category] ?? 0) + Number(t.amount);
  }

  // Find all unique months recorded in budgets or transactions
  const monthSet = new Set<string>();
  allBudgets.forEach((b) => monthSet.add(b.month));
  Object.keys(monthlyTotals).forEach((m) => monthSet.add(m));

  const sortedMonths = Array.from(monthSet).sort().slice(-monthsCount);

  const history: MonthBudgetHistory[] = [];
  const catOverspendCount: Record<string, number> = {};
  const catUtilizations: Record<string, number[]> = {};
  let onTrackCount = 0;
  let budgetedMonthsCount = 0;

  for (const m of sortedMonths) {
    const monthBudgets = allBudgets.filter((b) => b.month === m);
    const overall = monthBudgets.find((b) => !b.category);
    const overallAmt = overall ? overall.budgetAmount : null;
    const actual = monthlyTotals[m] ?? 0;
    const catActuals = monthlyCategoryTotals[m] ?? {};

    let remaining: number | null = null;
    let utilization: number | null = null;
    let status: MonthBudgetHistory["status"] = "unbudgeted";

    if (overallAmt !== null) {
      budgetedMonthsCount++;
      remaining = overallAmt - actual;
      utilization = overallAmt > 0 ? (actual / overallAmt) * 100 : 0;
      if (actual > overallAmt) {
        status = "exceeded";
      } else if (utilization >= 80) {
        status = "warning";
      } else {
        status = "on_track";
        onTrackCount++;
      }
    }

    let overCount = 0;
    for (const b of monthBudgets.filter((x) => x.category)) {
      const cat = b.category!;
      const spent = catActuals[cat] ?? 0;
      const u = b.budgetAmount > 0 ? (spent / b.budgetAmount) * 100 : 0;
      if (!catUtilizations[cat]) catUtilizations[cat] = [];
      catUtilizations[cat].push(u);

      if (spent > b.budgetAmount) {
        overCount++;
        catOverspendCount[cat] = (catOverspendCount[cat] ?? 0) + 1;
      }
    }

    history.push({
      month: m,
      overallBudget: overallAmt,
      actualExpenses: actual,
      remaining,
      utilization: utilization !== null ? Math.round(utilization * 10) / 10 : null,
      status,
      categoriesOverBudgetCount: overCount,
    });
  }

  const repeatedOverspendingCategories = Object.entries(catOverspendCount)
    .filter(([_, count]) => count >= 2)
    .map(([category, occurrences]) => ({ category, occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences);

  const consistentlyUnusedCategories = Object.entries(catUtilizations)
    .filter(([_, utils]) => utils.length >= 2)
    .map(([category, utils]) => {
      const avg = utils.reduce((a, b) => a + b, 0) / utils.length;
      return { category, averageUtilization: Math.round(avg * 10) / 10 };
    })
    .filter((c) => c.averageUtilization < 60)
    .sort((a, b) => a.averageUtilization - b.averageUtilization);

  const overallAdherenceRate =
    budgetedMonthsCount > 0
      ? Math.round((onTrackCount / budgetedMonthsCount) * 100)
      : 100;

  return {
    history,
    repeatedOverspendingCategories,
    consistentlyUnusedCategories,
    overallAdherenceRate,
  };
}

// ---------------------------------------------------------------------------
// Budget Planning Wizard Helpers
// ---------------------------------------------------------------------------

export interface PlanningWizardSuggestion {
  targetMonth: string;
  suggestedOverallBudget: number;
  suggestedCategoryAllocations: {
    category: string;
    suggestedAmount: number;
    historicalAverage: number;
    lastMonthSpend: number;
  }[];
  previousMonthBudget: number | null;
  historicalMonthsCount: number;
}

export async function getBudgetPlanningSuggestions(
  targetMonth: string,
  userId?: number,
): Promise<PlanningWizardSuggestion> {
  const txns = await getTransactions({ userId });
  const expenseTxns = txns.filter((t) => t.transactionType === "Expense");

  // Determine past completed months
  const monthlySpendByCat: Record<string, Record<string, number>> = {};
  const monthlyTotalSpend: Record<string, number> = {};

  for (const t of expenseTxns) {
    const m = normalizeMonthKey(t.transactionDate);
    if (m >= targetMonth) continue; // Only look prior to target
    monthlyTotalSpend[m] = (monthlyTotalSpend[m] ?? 0) + Number(t.amount);
    if (!monthlySpendByCat[m]) monthlySpendByCat[m] = {};
    monthlySpendByCat[m][t.category] =
      (monthlySpendByCat[m][t.category] ?? 0) + Number(t.amount);
  }

  const pastMonths = Object.keys(monthlyTotalSpend).sort();
  const recent3Months = pastMonths.slice(-3);
  const lastMonthKey = pastMonths[pastMonths.length - 1];

  let suggestedOverall = 25000;
  if (recent3Months.length > 0) {
    const sum = recent3Months.reduce((a, m) => a + monthlyTotalSpend[m], 0);
    const avg = sum / recent3Months.length;
    suggestedOverall = Math.round((avg * 1.05) / 500) * 500;
  }

  // Get previous month overall budget
  let previousMonthBudget: number | null = null;
  if (lastMonthKey) {
    const prevBudgets = await getBudgets(lastMonthKey, userId);
    const prevOverall = prevBudgets.find((b) => !b.category);
    if (prevOverall) previousMonthBudget = prevOverall.budgetAmount;
  }

  // Compute category averages
  const allCategories = new Set<string>();
  recent3Months.forEach((m) => {
    Object.keys(monthlySpendByCat[m] ?? {}).forEach((c) => allCategories.add(c));
  });

  const categoryAllocations = Array.from(allCategories).map((cat) => {
    const spends = recent3Months.map((m) => monthlySpendByCat[m]?.[cat] ?? 0);
    const avgSpend = spends.length
      ? spends.reduce((a, b) => a + b, 0) / spends.length
      : 0;
    const lastSpend = lastMonthKey ? monthlySpendByCat[lastMonthKey]?.[cat] ?? 0 : 0;
    const suggested = Math.round((avgSpend * 1.05) / 100) * 100;
    return {
      category: cat,
      suggestedAmount: Math.max(500, suggested),
      historicalAverage: Math.round(avgSpend * 100) / 100,
      lastMonthSpend: Math.round(lastSpend * 100) / 100,
    };
  });

  categoryAllocations.sort((a, b) => b.suggestedAmount - a.suggestedAmount);

  return {
    targetMonth,
    suggestedOverallBudget: Math.max(1000, suggestedOverall),
    suggestedCategoryAllocations: categoryAllocations,
    previousMonthBudget,
    historicalMonthsCount: recent3Months.length,
  };
}
