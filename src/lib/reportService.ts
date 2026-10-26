import { getTransactions, type TransactionFilters } from "./transactionService";
import { computeAnalytics } from "./analytics";
import { getBudgets, computeBudgetStatus } from "./budgetService";
import { getForecastStatus } from "@/ml/pipeline";
import { getSettings } from "./settingsService";
import { detectAnomalies } from "./insights";
import {
  normalizeMonthKey,
  addMonths,
  getMonthName,
  DEFAULT_SETTINGS,
} from "./config";
import type { Transaction, Budget } from "./types";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { formatCurrency } from "./format";

// ---------------------------------------------------------------------------
// Parameters & Data Models
// ---------------------------------------------------------------------------

export interface ReportParams {
  mode: "monthly" | "yearly";
  month?: string; // YYYY-MM
  year?: string; // YYYY
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  category?: string;
  paymentMethod?: string;
}

export interface ReportMeta {
  reportTitle: string;
  userName: string;
  userEmail?: string;
  generatedAt: string;
  generatedAtFormatted: string;
  mode: "monthly" | "yearly";
  periodLabel: string;
  startDate: string;
  endDate: string;
  dateRangeFormatted: string;
  calendarDays: number;
  currency: string;
  locale: string;
}

export interface ReportKpis {
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  netSavings: number;
  savingsRate: number | null;
  savingsRateStatus: "valid" | "no_income" | "negative";
  savingsRateLabel: string;
  totalTransactions: number;
  expenseTransactionsCount: number;
  incomeTransactionsCount: number;
  avgExpensePerTransaction: number;
  highestExpense: {
    amount: number;
    category: string;
    description: string | null;
    date: string;
  } | null;
  calendarDays: number;
  activeSpendingDays: number;
  zeroSpendingDays: number;
  avgDailySpend: number;
  avgDailyActiveSpend: number;
  avgMonthlyExpense: number;
  previousPeriod: {
    hasData: boolean;
    periodLabel: string;
    totalIncome: number;
    totalExpenses: number;
    netSavings: number;
    expenseDiff: number;
    expenseDiffPct: number | null;
    incomeDiff: number;
    incomeDiffPct: number | null;
    savingsDiff: number;
  } | null;
}

export interface ReportCategoryItem {
  category: string;
  total: number;
  percentage: number;
  transactionCount: number;
  avgTransactionAmount: number;
  highestTransaction: {
    amount: number;
    description: string | null;
    date: string;
  } | null;
  previousPeriodTotal: number | null;
  diffAmount: number | null;
  diffPct: number | null;
  isNew: boolean;
}

export interface ReportPaymentMethodItem {
  method: string;
  total: number;
  percentage: number;
  transactionCount: number;
  avgTransactionAmount: number;
}

export interface ReportDailySpendingItem {
  date: string;
  dayOfWeek: string;
  amount: number;
  transactionCount: number;
}

export interface ReportWeeklySpendingItem {
  weekKey: string;
  weekLabel: string;
  amount: number;
  transactionCount: number;
  avgDaily: number;
}

export interface ReportSpendingPatterns {
  highestSpendingDay: {
    date: string;
    amount: number;
    transactionCount: number;
  } | null;
  lowestSpendingDayActive: {
    date: string;
    amount: number;
    transactionCount: number;
  } | null;
  zeroSpendingDaysCount: number;
  mostFrequentCategory: {
    category: string;
    count: number;
    percentageOfTransactions: number;
  } | null;
  largestTransaction: {
    amount: number;
    category: string;
    description: string | null;
    date: string;
  } | null;
  spendingConcentration: {
    top1Category: string | null;
    top1Percentage: number;
    top3Categories: string[];
    top3Percentage: number;
  };
  anomalies: {
    id: number;
    date: string;
    amount: number;
    category: string;
    description: string | null;
    deviationReason: string;
  }[];
  trendExplanation: string;
}

export interface ReportBudgetStatus {
  hasBudget: boolean;
  overallBudget: number | null;
  actualExpenses: number;
  remaining: number | null;
  utilization: number | null;
  overBudgetAmount: number;
  status: "within_budget" | "near_limit" | "over_budget" | "not_configured";
  statusLabel: string;
  explanation: string;
  categoryBreakdown: {
    category: string;
    budget: number;
    actual: number;
    remaining: number;
    utilization: number;
    overBudgetAmount: number;
    status: "within_budget" | "near_limit" | "over_budget";
    statusLabel: string;
  }[];
}

export interface ReportForecast {
  targetMonth: string;
  targetMonthLabel: string;
  predictedExpense: number | null;
  status: string;
  method: string;
  explanation: string;
  historicalSeries: { month: string; amount: number }[];
  modelDetails: {
    modelVersion: string | null;
    datasetMode: string | null;
    trainingStatus: string | null;
    mae: number | null;
    rmse: number | null;
    mape: number | null;
    trainSamples: number | null;
    testSamples: number | null;
    lastTrainedAt: string | null;
    evalObservationsCount: number | null;
  } | null;
  baselineComparison: {
    name: string;
    mae: number | null;
    rmse: number | null;
  }[] | null;
  forecastVsBudget: {
    budget: number | null;
    difference: number | null;
    status: "over" | "under" | "no_budget";
  } | null;
  plainEnglishSummary: string;
}

export interface ReportInsightItem {
  id: string;
  title: string;
  detail: string;
  type: "positive" | "warning" | "alert" | "neutral";
  recommendation?: string;
}

export interface ReportTransactionItem {
  id: number;
  date: string;
  description: string | null;
  category: string;
  type: "Income" | "Expense";
  paymentMethod: string;
  amount: number;
}

export interface ReportResult {
  meta: ReportMeta;
  kpis: ReportKpis;
  byCategory: ReportCategoryItem[];
  categoryExplanation: string;
  byPaymentMethod: ReportPaymentMethodItem[];
  paymentMethodReconciled: boolean;
  monthly: { month: string; income: number; expense: number }[];
  dailySpending: ReportDailySpendingItem[];
  weeklySpending: ReportWeeklySpendingItem[];
  patterns: ReportSpendingPatterns;
  budgetPerformance: ReportBudgetStatus;
  forecast: ReportForecast;
  insights: ReportInsightItem[];
  transactions: ReportTransactionItem[];
}

// ---------------------------------------------------------------------------
// Pure Date & Calculation Utilities
// ---------------------------------------------------------------------------

export function lastDayOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${monthKey}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function calendarDaysInPeriod(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diffTime = end.getTime() - start.getTime();
  if (Number.isNaN(diffTime) || diffTime < 0) return 1;
  return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

export function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${monthNames[m - 1]} ${String(d).padStart(2, "0")}, ${y}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${getMonthName(m)} ${y}`;
}

// ---------------------------------------------------------------------------
// Pure Metric Calculators
// ---------------------------------------------------------------------------

export function calculateReportKpis(
  txns: Transaction[],
  calendarDays: number,
  previousPeriodTxns?: Transaction[] | null,
  previousPeriodLabel?: string,
): ReportKpis {
  const expenseTxns = txns.filter((t) => t.transactionType === "Expense");
  const incomeTxns = txns.filter((t) => t.transactionType === "Income");

  const totalIncome = incomeTxns.reduce((a, t) => a + Number(t.amount || 0), 0);
  const totalExpenses = expenseTxns.reduce((a, t) => a + Number(t.amount || 0), 0);
  const netCashFlow = totalIncome - totalExpenses;
  const netSavings = netCashFlow;

  let savingsRate: number | null = null;
  let savingsRateStatus: ReportKpis["savingsRateStatus"] = "no_income";
  let savingsRateLabel = "Not available — no income recorded";

  if (totalIncome > 0) {
    const rawRate = ((totalIncome - totalExpenses) / totalIncome) * 100;
    savingsRate = Math.round(rawRate * 10) / 10;
    if (rawRate < 0) {
      savingsRateStatus = "negative";
      savingsRateLabel = `${savingsRate.toFixed(1)}% (Negative Cash Flow)`;
    } else {
      savingsRateStatus = "valid";
      savingsRateLabel = `${savingsRate.toFixed(1)}%`;
    }
  }

  const totalTransactions = txns.length;
  const expenseTransactionsCount = expenseTxns.length;
  const incomeTransactionsCount = incomeTxns.length;

  const avgExpensePerTransaction =
    expenseTransactionsCount > 0
      ? Math.round((totalExpenses / expenseTransactionsCount) * 100) / 100
      : 0;

  let highestExpense: ReportKpis["highestExpense"] = null;
  for (const t of expenseTxns) {
    const amt = Number(t.amount || 0);
    if (!highestExpense || amt > highestExpense.amount) {
      highestExpense = {
        amount: amt,
        category: t.category,
        description: t.description ?? null,
        date: t.transactionDate,
      };
    }
  }

  const uniqueExpenseDays = new Set(expenseTxns.map((t) => t.transactionDate));
  const activeSpendingDays = uniqueExpenseDays.size;
  const zeroSpendingDays = Math.max(0, calendarDays - activeSpendingDays);

  const avgDailySpend =
    calendarDays > 0 ? Math.round((totalExpenses / calendarDays) * 100) / 100 : 0;
  const avgDailyActiveSpend =
    activeSpendingDays > 0
      ? Math.round((totalExpenses / activeSpendingDays) * 100) / 100
      : 0;

  // Compute average monthly expense across distinct months observed in txns
  const uniqueMonths = new Set(txns.map((t) => normalizeMonthKey(t.transactionDate)));
  const monthsCount = Math.max(1, uniqueMonths.size);
  const avgMonthlyExpense = Math.round((totalExpenses / monthsCount) * 100) / 100;

  // Previous period comparison
  let previousPeriod: ReportKpis["previousPeriod"] = null;
  if (previousPeriodTxns && previousPeriodTxns.length > 0) {
    const prevExpenseTxns = previousPeriodTxns.filter((t) => t.transactionType === "Expense");
    const prevIncomeTxns = previousPeriodTxns.filter((t) => t.transactionType === "Income");
    const prevExpenses = prevExpenseTxns.reduce((a, t) => a + Number(t.amount || 0), 0);
    const prevIncome = prevIncomeTxns.reduce((a, t) => a + Number(t.amount || 0), 0);
    const prevSavings = prevIncome - prevExpenses;

    const expenseDiff = Math.round((totalExpenses - prevExpenses) * 100) / 100;
    const expenseDiffPct =
      prevExpenses > 0
        ? Math.round(((totalExpenses - prevExpenses) / prevExpenses) * 1000) / 10
        : null;

    const incomeDiff = Math.round((totalIncome - prevIncome) * 100) / 100;
    const incomeDiffPct =
      prevIncome > 0
        ? Math.round(((totalIncome - prevIncome) / prevIncome) * 1000) / 10
        : null;

    const savingsDiff = Math.round((netSavings - prevSavings) * 100) / 100;

    previousPeriod = {
      hasData: true,
      periodLabel: previousPeriodLabel || "Previous Period",
      totalIncome: prevIncome,
      totalExpenses: prevExpenses,
      netSavings: prevSavings,
      expenseDiff,
      expenseDiffPct,
      incomeDiff,
      incomeDiffPct,
      savingsDiff,
    };
  } else if (previousPeriodTxns !== undefined) {
    previousPeriod = {
      hasData: false,
      periodLabel: previousPeriodLabel || "Previous Period",
      totalIncome: 0,
      totalExpenses: 0,
      netSavings: 0,
      expenseDiff: 0,
      expenseDiffPct: null,
      incomeDiff: 0,
      incomeDiffPct: null,
      savingsDiff: 0,
    };
  }

  return {
    totalIncome,
    totalExpenses,
    netCashFlow,
    netSavings,
    savingsRate,
    savingsRateStatus,
    savingsRateLabel,
    totalTransactions,
    expenseTransactionsCount,
    incomeTransactionsCount,
    avgExpensePerTransaction,
    highestExpense,
    calendarDays,
    activeSpendingDays,
    zeroSpendingDays,
    avgDailySpend,
    avgDailyActiveSpend,
    avgMonthlyExpense,
    previousPeriod,
  };
}

export function calculateCategoryBreakdown(
  expenseTxns: Transaction[],
  totalExpenses: number,
  prevExpenseTxns?: Transaction[] | null,
  hasPrevData = false,
): ReportCategoryItem[] {
  const catMap = new Map<
    string,
    {
      total: number;
      count: number;
      highest: { amount: number; description: string | null; date: string } | null;
    }
  >();

  for (const t of expenseTxns) {
    const cat = t.category.trim() || "Other";
    const amt = Number(t.amount || 0);
    const existing = catMap.get(cat) ?? { total: 0, count: 0, highest: null };
    existing.total += amt;
    existing.count += 1;
    if (!existing.highest || amt > existing.highest.amount) {
      existing.highest = {
        amount: amt,
        description: t.description ?? null,
        date: t.transactionDate,
      };
    }
    catMap.set(cat, existing);
  }

  const prevCatTotals = new Map<string, number>();
  if (hasPrevData && prevExpenseTxns) {
    for (const t of prevExpenseTxns) {
      const cat = t.category.trim() || "Other";
      prevCatTotals.set(cat, (prevCatTotals.get(cat) ?? 0) + Number(t.amount || 0));
    }
  }

  const items: ReportCategoryItem[] = [];
  for (const [category, data] of catMap.entries()) {
    const total = Math.round(data.total * 100) / 100;
    const percentage =
      totalExpenses > 0
        ? Math.round((total / totalExpenses) * 1000) / 10
        : 0;
    const avgTransactionAmount =
      data.count > 0 ? Math.round((total / data.count) * 100) / 100 : 0;

    let previousPeriodTotal: number | null = null;
    let diffAmount: number | null = null;
    let diffPct: number | null = null;
    let isNew = false;

    if (hasPrevData) {
      const prev = prevCatTotals.get(category) ?? 0;
      previousPeriodTotal = Math.round(prev * 100) / 100;
      diffAmount = Math.round((total - prev) * 100) / 100;
      diffPct =
        prev > 0 ? Math.round(((total - prev) / prev) * 1000) / 10 : null;
      isNew = prev === 0;
    }

    items.push({
      category,
      total,
      percentage,
      transactionCount: data.count,
      avgTransactionAmount,
      highestTransaction: data.highest,
      previousPeriodTotal,
      diffAmount,
      diffPct,
      isNew,
    });
  }

  // Sort descending by total amount
  return items.sort((a, b) => b.total - a.total);
}

export function generateCategoryExplanation(
  categories: ReportCategoryItem[],
  totalExpenses: number,
  periodLabel: string,
): string {
  if (categories.length === 0 || totalExpenses <= 0) {
    return `No expense transactions were recorded for ${periodLabel}.`;
  }

  const top = categories[0];
  let text = `${top.category} accounted for ${top.percentage.toFixed(1)}% of your total expenses (${formatCurrency(top.total)}), making it your highest spending category across ${top.transactionCount} transaction${top.transactionCount === 1 ? "" : "s"}.`;

  if (categories.length > 1) {
    const second = categories[1];
    text += ` ${second.category} was your second largest category, representing ${second.percentage.toFixed(1)}% (${formatCurrency(second.total)}).`;
  }

  if (top.diffAmount !== null && top.previousPeriodTotal !== null) {
    if (top.diffAmount > 0) {
      text += ` Spending in ${top.category} increased by ${formatCurrency(top.diffAmount)}${top.diffPct !== null ? ` (+${top.diffPct.toFixed(1)}%)` : ""} compared with the prior period.`;
    } else if (top.diffAmount < 0) {
      text += ` Spending in ${top.category} decreased by ${formatCurrency(Math.abs(top.diffAmount))}${top.diffPct !== null ? ` (${top.diffPct.toFixed(1)}%)` : ""} compared with the prior period.`;
    } else {
      text += ` Spending in ${top.category} remained steady compared with the prior period.`;
    }
  }

  return text;
}

export function calculatePaymentMethodBreakdown(
  expenseTxns: Transaction[],
  totalExpenses: number,
): { items: ReportPaymentMethodItem[]; reconciled: boolean } {
  const methodMap = new Map<string, { total: number; count: number }>();

  for (const t of expenseTxns) {
    const method = t.paymentMethod?.trim() || "Unspecified / Other";
    const amt = Number(t.amount || 0);
    const existing = methodMap.get(method) ?? { total: 0, count: 0 };
    existing.total += amt;
    existing.count += 1;
    methodMap.set(method, existing);
  }

  const items: ReportPaymentMethodItem[] = [];
  let sum = 0;
  for (const [method, data] of methodMap.entries()) {
    const total = Math.round(data.total * 100) / 100;
    sum += total;
    const percentage =
      totalExpenses > 0
        ? Math.round((total / totalExpenses) * 1000) / 10
        : 0;
    const avgTransactionAmount =
      data.count > 0 ? Math.round((total / data.count) * 100) / 100 : 0;

    items.push({
      method,
      total,
      percentage,
      transactionCount: data.count,
      avgTransactionAmount,
    });
  }

  items.sort((a, b) => b.total - a.total);
  const reconciled = Math.abs(sum - totalExpenses) < 0.05;

  return { items, reconciled };
}

export function calculateSpendingPatterns(
  expenseTxns: Transaction[],
  startDate: string,
  endDate: string,
  allHistoricalExpenses: Transaction[],
): {
  dailySpending: ReportDailySpendingItem[];
  weeklySpending: ReportWeeklySpendingItem[];
  patterns: ReportSpendingPatterns;
} {
  // 1. Daily timeline across every calendar day in [startDate, endDate]
  const dayMap = new Map<string, { amount: number; count: number }>();
  for (const t of expenseTxns) {
    const d = t.transactionDate;
    const cur = dayMap.get(d) ?? { amount: 0, count: 0 };
    cur.amount += Number(t.amount || 0);
    cur.count += 1;
    dayMap.set(d, cur);
  }

  const dailySpending: ReportDailySpendingItem[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const cursor = new Date(start);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  while (cursor <= end) {
    const isoDate = cursor.toISOString().slice(0, 10);
    const data = dayMap.get(isoDate) ?? { amount: 0, count: 0 };
    dailySpending.push({
      date: isoDate,
      dayOfWeek: dayNames[cursor.getUTCDay()],
      amount: Math.round(data.amount * 100) / 100,
      transactionCount: data.count,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const daysWithSpending = dailySpending.filter((d) => d.amount > 0);
  const zeroSpendingDaysCount = dailySpending.filter((d) => d.amount === 0).length;

  let highestSpendingDay: ReportSpendingPatterns["highestSpendingDay"] = null;
  let lowestSpendingDayActive: ReportSpendingPatterns["lowestSpendingDayActive"] = null;

  for (const d of daysWithSpending) {
    if (!highestSpendingDay || d.amount > highestSpendingDay.amount) {
      highestSpendingDay = {
        date: d.date,
        amount: d.amount,
        transactionCount: d.transactionCount,
      };
    }
    if (!lowestSpendingDayActive || d.amount < lowestSpendingDayActive.amount) {
      lowestSpendingDayActive = {
        date: d.date,
        amount: d.amount,
        transactionCount: d.transactionCount,
      };
    }
  }

  // 2. Weekly spending breakdown
  const weekMap = new Map<
    string,
    { startDate: string; endDate: string; amount: number; count: number; days: number }
  >();

  for (let i = 0; i < dailySpending.length; i += 7) {
    const chunk = dailySpending.slice(i, i + 7);
    const wKey = `Week ${Math.floor(i / 7) + 1}`;
    const wStart = chunk[0].date;
    const wEnd = chunk[chunk.length - 1].date;
    const wAmt = chunk.reduce((acc, c) => acc + c.amount, 0);
    const wCount = chunk.reduce((acc, c) => acc + c.transactionCount, 0);
    const wLabel = `${formatDateLabel(wStart).slice(0, 6)} – ${formatDateLabel(wEnd).slice(0, 6)}`;

    weekMap.set(wKey, {
      startDate: wStart,
      endDate: wEnd,
      amount: Math.round(wAmt * 100) / 100,
      count: wCount,
      days: chunk.length,
    });
  }

  const weeklySpending: ReportWeeklySpendingItem[] = [];
  for (const [key, val] of weekMap.entries()) {
    weeklySpending.push({
      weekKey: key,
      weekLabel: `${formatDateLabel(val.startDate).slice(0, 6)} – ${formatDateLabel(val.endDate).slice(0, 6)}`,
      amount: val.amount,
      transactionCount: val.count,
      avgDaily: val.days > 0 ? Math.round((val.amount / val.days) * 100) / 100 : 0,
    });
  }

  // 3. Most frequent spending category
  const catCountMap = new Map<string, number>();
  for (const t of expenseTxns) {
    const c = t.category.trim() || "Other";
    catCountMap.set(c, (catCountMap.get(c) ?? 0) + 1);
  }

  let mostFrequentCategory: ReportSpendingPatterns["mostFrequentCategory"] = null;
  for (const [cat, count] of catCountMap.entries()) {
    if (!mostFrequentCategory || count > mostFrequentCategory.count) {
      mostFrequentCategory = {
        category: cat,
        count,
        percentageOfTransactions:
          expenseTxns.length > 0
            ? Math.round((count / expenseTxns.length) * 1000) / 10
            : 0,
      };
    }
  }

  // 4. Largest individual transaction
  let largestTransaction: ReportSpendingPatterns["largestTransaction"] = null;
  for (const t of expenseTxns) {
    const amt = Number(t.amount || 0);
    if (!largestTransaction || amt > largestTransaction.amount) {
      largestTransaction = {
        amount: amt,
        category: t.category,
        description: t.description ?? null,
        date: t.transactionDate,
      };
    }
  }

  // 5. Category concentration
  const catTotals = new Map<string, number>();
  for (const t of expenseTxns) {
    const c = t.category.trim() || "Other";
    catTotals.set(c, (catTotals.get(c) ?? 0) + Number(t.amount || 0));
  }
  const sortedCatEntries = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
  const totalExp = expenseTxns.reduce((a, t) => a + Number(t.amount || 0), 0);

  const top1Category = sortedCatEntries[0]?.[0] ?? null;
  const top1Percentage =
    top1Category && totalExp > 0
      ? Math.round((sortedCatEntries[0][1] / totalExp) * 1000) / 10
      : 0;

  const top3Entries = sortedCatEntries.slice(0, 3);
  const top3Categories = top3Entries.map((e) => e[0]);
  const top3Sum = top3Entries.reduce((a, e) => a + e[1], 0);
  const top3Percentage =
    totalExp > 0 ? Math.round((top3Sum / totalExp) * 1000) / 10 : 0;

  // 6. Anomalies detection (Z-score > 2 over historical baseline)
  const { anomalies: historicalAnomalies, mean, std } = detectAnomalies(
    allHistoricalExpenses,
    2,
    10,
  );
  const periodAnomalies = historicalAnomalies
    .filter((t) => t.transactionDate >= startDate && t.transactionDate <= endDate)
    .map((a) => {
      const amt = Number(a.amount || 0);
      const diff = amt - mean;
      return {
        id: a.id,
        date: a.transactionDate,
        amount: amt,
        category: a.category,
        description: a.description ?? null,
        deviationReason: `Amount (${formatCurrency(amt)}) significantly exceeded your historical expense mean of ${formatCurrency(mean)} by ${formatCurrency(diff)} (standard deviation: ${formatCurrency(std)}).`,
      };
    });

  // 7. Plain-English summary of trends
  let trendExplanation = "";
  if (expenseTxns.length === 0) {
    trendExplanation = "No expenses recorded during this period.";
  } else {
    trendExplanation = `Expenses were recorded across ${daysWithSpending.length} active day(s), with ${zeroSpendingDaysCount} zero-spending day(s). The top 3 spending categories accounted for ${top3Percentage.toFixed(1)}% of all expenditures.`;
    if (highestSpendingDay) {
      trendExplanation += ` Peak spending occurred on ${formatDateLabel(highestSpendingDay.date)} (${formatCurrency(highestSpendingDay.amount)}).`;
    }
  }

  return {
    dailySpending,
    weeklySpending,
    patterns: {
      highestSpendingDay,
      lowestSpendingDayActive,
      zeroSpendingDaysCount,
      mostFrequentCategory,
      largestTransaction,
      spendingConcentration: {
        top1Category,
        top1Percentage,
        top3Categories,
        top3Percentage,
      },
      anomalies: periodAnomalies,
      trendExplanation,
    },
  };
}

export function calculateBudgetPerformance(
  monthOrPeriod: string,
  totalExpenses: number,
  categoryExpenses: Record<string, number>,
  budgets: Budget[],
  warningThreshold = DEFAULT_SETTINGS.warningThreshold,
): ReportBudgetStatus {
  const overall = budgets.find((b) => b.category === null || b.category === "");

  if (!overall) {
    return {
      hasBudget: false,
      overallBudget: null,
      actualExpenses: totalExpenses,
      remaining: null,
      utilization: null,
      overBudgetAmount: 0,
      status: "not_configured",
      statusLabel: "Not Configured",
      explanation:
        "No budget configured for this period. Set a budget to track your spending against a financial target.",
      categoryBreakdown: [],
    };
  }

  const budgetAmt = Number(overall.budgetAmount || 0);
  const remaining = Math.round((budgetAmt - totalExpenses) * 100) / 100;
  const utilization =
    budgetAmt > 0 ? Math.round((totalExpenses / budgetAmt) * 1000) / 10 : 0;
  const overBudgetAmount =
    totalExpenses > budgetAmt
      ? Math.round((totalExpenses - budgetAmt) * 100) / 100
      : 0;

  let status: ReportBudgetStatus["status"] = "within_budget";
  let statusLabel = "Within Budget";
  let explanation = `Spending is within your budget: ${utilization.toFixed(1)}% used with ${formatCurrency(remaining)} remaining.`;

  if (totalExpenses > budgetAmt) {
    status = "over_budget";
    statusLabel = "Over Budget";
    explanation = `Spending has exceeded your monthly budget by ${formatCurrency(overBudgetAmount)} (${utilization.toFixed(1)}% utilized).`;
  } else if (utilization >= warningThreshold) {
    status = "near_limit";
    statusLabel = "Near Limit";
    explanation = `Approaching budget limit: ${utilization.toFixed(1)}% used (>= ${warningThreshold}% warning threshold). You have ${formatCurrency(remaining)} remaining.`;
  }

  const catBudgets = budgets.filter((b) => b.category !== null && b.category !== "");
  const categoryBreakdown = catBudgets.map((cb) => {
    const cat = cb.category as string;
    const catBudget = Number(cb.budgetAmount || 0);
    const catActual = Math.round((categoryExpenses[cat] ?? 0) * 100) / 100;
    const catRemaining = Math.round((catBudget - catActual) * 100) / 100;
    const catUtil =
      catBudget > 0 ? Math.round((catActual / catBudget) * 1000) / 10 : 0;
    const catOver =
      catActual > catBudget ? Math.round((catActual - catBudget) * 100) / 100 : 0;

    let cStatus: "within_budget" | "near_limit" | "over_budget" = "within_budget";
    let cLabel = "Within Budget";

    if (catActual > catBudget) {
      cStatus = "over_budget";
      cLabel = "Over Budget";
    } else if (catUtil >= warningThreshold) {
      cStatus = "near_limit";
      cLabel = "Near Limit";
    }

    return {
      category: cat,
      budget: catBudget,
      actual: catActual,
      remaining: catRemaining,
      utilization: catUtil,
      overBudgetAmount: catOver,
      status: cStatus,
      statusLabel: cLabel,
    };
  });

  return {
    hasBudget: true,
    overallBudget: budgetAmt,
    actualExpenses: totalExpenses,
    remaining,
    utilization,
    overBudgetAmount,
    status,
    statusLabel,
    explanation,
    categoryBreakdown,
  };
}

export function generateReportInsights(
  kpis: ReportKpis,
  categories: ReportCategoryItem[],
  budget: ReportBudgetStatus,
  forecast: ReportForecast,
  patterns: ReportSpendingPatterns,
): ReportInsightItem[] {
  const insights: ReportInsightItem[] = [];

  // 1. Category insights
  if (categories.length > 0) {
    const top = categories[0];
    insights.push({
      id: "top-category",
      title: `Highest Spending Category: ${top.category}`,
      detail: `${top.category} represents ${top.percentage.toFixed(1)}% of your expenses (${formatCurrency(top.total)}) across ${top.transactionCount} transaction${top.transactionCount === 1 ? "" : "s"}.`,
      type: "neutral",
    });

    // Categories with increased spending vs previous period
    const increased = categories.filter(
      (c) => c.diffAmount !== null && c.diffAmount > 0 && !c.isNew,
    );
    if (increased.length > 0) {
      const largestIncrease = increased.sort(
        (a, b) => (b.diffAmount ?? 0) - (a.diffAmount ?? 0),
      )[0];
      insights.push({
        id: `increased-category-${largestIncrease.category}`,
        title: `Spending Increase in ${largestIncrease.category}`,
        detail: `Your ${largestIncrease.category.toLowerCase()} spending increased by ${formatCurrency(largestIncrease.diffAmount!)} (${largestIncrease.diffPct !== null ? `+${largestIncrease.diffPct.toFixed(1)}%` : ""}) compared with the previous period.`,
        type: "warning",
        recommendation: `Reviewing ${largestIncrease.category.toLowerCase()} purchases may help identify potential discretionary savings opportunities.`,
      });
    }

    // Categories with decreased spending
    const decreased = categories.filter(
      (c) => c.diffAmount !== null && c.diffAmount < 0,
    );
    if (decreased.length > 0) {
      const largestDecrease = decreased.sort(
        (a, b) => (a.diffAmount ?? 0) - (b.diffAmount ?? 0),
      )[0];
      insights.push({
        id: `decreased-category-${largestDecrease.category}`,
        title: `Spending Reduction in ${largestDecrease.category}`,
        detail: `Your ${largestDecrease.category.toLowerCase()} spending reduced by ${formatCurrency(Math.abs(largestDecrease.diffAmount!))} (${largestDecrease.diffPct !== null ? `${largestDecrease.diffPct.toFixed(1)}%` : ""}) compared with the previous period.`,
        type: "positive",
        recommendation: `Effective spending control in ${largestDecrease.category} contributed positively to your overall savings.`,
      });
    }
  }

  // 2. Budget Insights
  if (budget.hasBudget) {
    if (budget.status === "over_budget") {
      insights.push({
        id: "budget-exceeded",
        title: "Monthly Budget Limit Exceeded",
        detail: `Overall spending exceeded your budget by ${formatCurrency(budget.overBudgetAmount)} (${budget.utilization?.toFixed(1)}% used).`,
        type: "alert",
        recommendation:
          "Review top spending categories and set category-specific caps to align outlays with your target.",
      });
    } else if (budget.status === "near_limit") {
      insights.push({
        id: "budget-warning",
        title: "Approaching Monthly Budget Limit",
        detail: `You have utilized ${budget.utilization?.toFixed(1)}% of your monthly budget, leaving ${formatCurrency(budget.remaining)} for remaining expenses.`,
        type: "warning",
        recommendation:
          "Pace non-essential discretionary purchases over the remaining days of the period.",
      });
    } else {
      insights.push({
        id: "budget-healthy",
        title: "Expenses Within Budget Target",
        detail: `Your spending is healthy at ${budget.utilization?.toFixed(1)}% of budget with ${formatCurrency(budget.remaining)} remaining.`,
        type: "positive",
      });
    }
  }

  // 3. Forecast insights & shortfall warnings
  if (
    forecast.predictedExpense !== null &&
    budget.hasBudget &&
    budget.overallBudget !== null &&
    forecast.predictedExpense > budget.overallBudget
  ) {
    const shortfall = Math.round((forecast.predictedExpense - budget.overallBudget) * 100) / 100;
    insights.push({
      id: "forecast-shortfall",
      title: "Projected Budget Shortfall for Next Month",
      detail: `Your next-month predicted spending of ${formatCurrency(forecast.predictedExpense)} exceeds your current monthly budget (${formatCurrency(budget.overallBudget)}) by ${formatCurrency(shortfall)}.`,
      type: "warning",
      recommendation:
        "Consider adjusting upcoming recurring expenses or increasing your budget allocation.",
    });
  }

  // 4. Anomaly review items
  if (patterns.anomalies.length > 0) {
    const count = patterns.anomalies.length;
    insights.push({
      id: "anomalies-detected",
      title: `${count} Unusual Expense${count === 1 ? "" : "s"} Deserving Review`,
      detail: `${count} transaction${count === 1 ? "" : "s"} in this period significantly deviated from your historical spending baseline.`,
      type: "warning",
      recommendation:
        "Inspect the flagged items in the Spending Patterns section to confirm they represent intended expenses rather than duplicate entries.",
    });
  }

  // 5. Savings opportunity from discretionary categories
  const discretionaryNames = [
    "Entertainment",
    "Shopping",
    "Subscriptions",
    "Travel",
    "Personal Care",
    "Food",
  ];
  const discretionaryItems = categories.filter((c) =>
    discretionaryNames.includes(c.category),
  );
  const discretionaryTotal = discretionaryItems.reduce((a, c) => a + c.total, 0);

  if (discretionaryTotal > 0 && kpis.totalExpenses > 0) {
    const discPct = Math.round((discretionaryTotal / kpis.totalExpenses) * 1000) / 10;
    if (discPct >= 20) {
      const minEst = Math.round(discretionaryTotal * 0.1);
      const maxEst = Math.round(discretionaryTotal * 0.2);
      insights.push({
        id: "discretionary-savings",
        title: "Discretionary Spending Opportunities",
        detail: `Discretionary categories (${discretionaryItems.map((c) => c.category).slice(0, 3).join(", ")}) totaled ${formatCurrency(discretionaryTotal)} (${discPct.toFixed(1)}% of your expenses).`,
        type: "neutral",
        recommendation: `Targeting a 10%–20% reduction in discretionary purchases could provide potential monthly savings of approximately ${formatCurrency(minEst)} to ${formatCurrency(maxEst)}.`,
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      id: "insufficient-history",
      title: "Building Financial History",
      detail: "More transaction history is needed to identify reliable spending patterns.",
      type: "neutral",
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Main Report Generation Pipeline
// ---------------------------------------------------------------------------

export async function buildReport(
  params: ReportParams,
  userId?: number,
  userProfile?: { name?: string; email?: string },
): Promise<ReportResult> {
  const mode = params.mode === "yearly" ? "yearly" : "monthly";
  let startDate: string;
  let endDate: string;
  let periodLabel: string;
  let prevStartDate: string;
  let prevEndDate: string;
  let prevPeriodLabel: string;

  if (mode === "monthly") {
    const month = params.month ?? normalizeMonthKey(new Date());
    startDate = `${month}-01`;
    endDate = lastDayOfMonth(month);
    periodLabel = formatMonthLabel(month);

    const prevMonth = addMonths(month, -1);
    prevStartDate = `${prevMonth}-01`;
    prevEndDate = lastDayOfMonth(prevMonth);
    prevPeriodLabel = formatMonthLabel(prevMonth);
  } else {
    const year = params.year ?? String(new Date().getUTCFullYear());
    startDate = `${year}-01-01`;
    endDate = `${year}-12-31`;
    periodLabel = `Year ${year}`;

    const prevYear = String(Number(year) - 1);
    prevStartDate = `${prevYear}-01-01`;
    prevEndDate = `${prevYear}-12-31`;
    prevPeriodLabel = `Year ${prevYear}`;
  }

  const calendarDays = calendarDaysInPeriod(startDate, endDate);

  // User Profile
  let userName = userProfile?.name;
  let userEmail = userProfile?.email;
  if (!userName && userId != null) {
    const [row] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (row) {
      userName = row.name;
      userEmail = row.email;
    }
  }
  userName = userName || "Personal Account";

  // App Settings
  const settings = await getSettings(userId);

  // Transactions: Current period
  const filterCriteria: TransactionFilters = {
    startDate,
    endDate,
    userId,
  };
  if (params.category) filterCriteria.category = params.category;
  if (params.paymentMethod) filterCriteria.paymentMethod = params.paymentMethod;

  const txns = await getTransactions(filterCriteria);

  // Transactions: Previous period (for comparison)
  const prevFilterCriteria: TransactionFilters = {
    startDate: prevStartDate,
    endDate: prevEndDate,
    userId,
  };
  if (params.category) prevFilterCriteria.category = params.category;
  if (params.paymentMethod) prevFilterCriteria.paymentMethod = params.paymentMethod;

  const prevTxns = await getTransactions(prevFilterCriteria);

  // All historical expenses for user (for statistical anomaly baseline)
  const allTxns = await getTransactions({ userId });
  const allHistoricalExpenses = allTxns.filter((t) => t.transactionType === "Expense");

  // Analytics Engine
  const analytics = computeAnalytics(txns, { startDate, endDate });
  const expenseTxns = txns.filter((t) => t.transactionType === "Expense");
  const prevExpenseTxns = prevTxns.filter((t) => t.transactionType === "Expense");

  // 1. KPIs
  const kpis = calculateReportKpis(
    txns,
    calendarDays,
    prevTxns,
    prevPeriodLabel,
  );

  // 2. Category Analysis
  const byCategory = calculateCategoryBreakdown(
    expenseTxns,
    kpis.totalExpenses,
    prevExpenseTxns,
    prevTxns.length > 0,
  );
  const categoryExplanation = generateCategoryExplanation(
    byCategory,
    kpis.totalExpenses,
    periodLabel,
  );

  // 3. Payment Method Analysis
  const { items: byPaymentMethod, reconciled: paymentMethodReconciled } =
    calculatePaymentMethodBreakdown(expenseTxns, kpis.totalExpenses);

  // 4. Daily & Weekly Spending Trends
  const { dailySpending, weeklySpending, patterns } = calculateSpendingPatterns(
    expenseTxns,
    startDate,
    endDate,
    allHistoricalExpenses,
  );

  // 5. Budget Performance
  const categoryExpensesMap: Record<string, number> = {};
  for (const t of expenseTxns) {
    categoryExpensesMap[t.category] =
      (categoryExpensesMap[t.category] ?? 0) + Number(t.amount || 0);
  }

  const budgetMonthKey = mode === "monthly" ? (params.month ?? normalizeMonthKey(new Date())) : `${params.year ?? new Date().getUTCFullYear()}-01`;
  const periodBudgets = await getBudgets(budgetMonthKey, userId);
  const budgetPerformance = calculateBudgetPerformance(
    budgetMonthKey,
    kpis.totalExpenses,
    categoryExpensesMap,
    periodBudgets,
    settings.warningThreshold,
  );

  // 6. LSTM Forecast Status
  const rawForecast = await getForecastStatus(userId);
  const targetMonth = rawForecast.targetMonth ?? addMonths(normalizeMonthKey(new Date()), 1);
  const targetMonthLabel = formatMonthLabel(targetMonth);

  let plainEnglishSummary = "";
  if (rawForecast.latestRun && rawForecast.latestRun.mae != null && rawForecast.predictedExpense != null) {
    plainEnglishSummary = `The model predicts expenses of ${formatCurrency(rawForecast.predictedExpense)} for ${targetMonthLabel}. Its historical MAE is ${formatCurrency(rawForecast.latestRun.mae)}, meaning its average absolute prediction error on the evaluated observations was approximately ${formatCurrency(rawForecast.latestRun.mae)}.`;
  } else if (rawForecast.predictedExpense != null) {
    plainEnglishSummary = `A baseline expenditure forecast of ${formatCurrency(rawForecast.predictedExpense)} is projected for ${targetMonthLabel} based on ${rawForecast.forecastingMethod ?? "historical weighted baseline"}.`;
  } else {
    plainEnglishSummary =
      "An expenditure forecast cannot yet be generated. Add at least 6 months of historical transactions to enable personalized LSTM predictions.";
  }

  const baselineComparison = rawForecast.evaluation?.baselines
    ? rawForecast.evaluation.baselines.map((b) => ({
        name: b.name,
        mae: b.metrics.mae,
        rmse: b.metrics.rmse,
      }))
    : null;

  const forecast: ReportForecast = {
    targetMonth,
    targetMonthLabel,
    predictedExpense: rawForecast.predictedExpense,
    status: rawForecast.predictionStatus ?? rawForecast.modelStatus,
    method: rawForecast.forecastingMethod ?? (rawForecast.hasModel ? "LSTM Deep Learning" : "Baseline"),
    explanation: rawForecast.explanation ?? "Forecast based on historical expenditures.",
    historicalSeries: rawForecast.personalized?.historicalSeries ?? [],
    modelDetails: rawForecast.latestRun
      ? {
          modelVersion: rawForecast.modelVersion,
          datasetMode: rawForecast.datasetMode,
          trainingStatus: rawForecast.latestRun.status,
          mae: rawForecast.latestRun.mae,
          rmse: rawForecast.latestRun.rmse,
          mape: rawForecast.latestRun.mape,
          trainSamples: rawForecast.latestRun.trainSamples,
          testSamples: rawForecast.meta?.testMonths ?? null,
          lastTrainedAt: rawForecast.lastTrainedAt,
          evalObservationsCount: rawForecast.meta?.testMonths ?? null,
        }
      : null,
    baselineComparison,
    forecastVsBudget: rawForecast.personalized?.budgetComparison ?? null,
    plainEnglishSummary,
  };

  // 7. Smart Insights
  const insights = generateReportInsights(
    kpis,
    byCategory,
    budgetPerformance,
    forecast,
    patterns,
  );

  // 8. Transaction Details Appendix
  const transactionItems: ReportTransactionItem[] = txns
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.id - a.id)
    .map((t) => ({
      id: t.id,
      date: t.transactionDate,
      description: t.description ?? null,
      category: t.category,
      type: t.transactionType,
      paymentMethod: t.paymentMethod,
      amount: Number(t.amount || 0),
    }));

  const now = new Date();
  const meta: ReportMeta = {
    reportTitle: "Personal Expense Analysis Report",
    userName,
    userEmail,
    generatedAt: now.toISOString(),
    generatedAtFormatted: `${formatDateLabel(now.toISOString().slice(0, 10))} at ${now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
    mode,
    periodLabel,
    startDate,
    endDate,
    dateRangeFormatted: `${formatDateLabel(startDate)} – ${formatDateLabel(endDate)}`,
    calendarDays,
    currency: settings.currency,
    locale: settings.locale,
  };

  return {
    meta,
    kpis,
    byCategory,
    categoryExplanation,
    byPaymentMethod,
    paymentMethodReconciled,
    monthly: analytics.byMonth,
    dailySpending,
    weeklySpending,
    patterns,
    budgetPerformance,
    forecast,
    insights,
    transactions: transactionItems,
  };
}
