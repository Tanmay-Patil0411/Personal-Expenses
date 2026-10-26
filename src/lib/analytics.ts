import type { Transaction } from "./types";
import { normalizeMonthKey } from "./config";

// ---------------------------------------------------------------------------
// Pure, Pandas-style aggregation helpers built on plain arrays so they can be
// unit tested without a database. All expense calculations explicitly exclude
// Income transactions.
// ---------------------------------------------------------------------------

export function isExpense(t: Transaction): boolean {
  return t.transactionType === "Expense";
}

export function isIncome(t: Transaction): boolean {
  return t.transactionType === "Income";
}

export function expensesOnly(transactions: Transaction[]): Transaction[] {
  return transactions.filter(isExpense);
}

export function sumAmounts(rows: Transaction[]): number {
  return rows.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
}

export function totalsByType(transactions: Transaction[]): {
  income: number;
  expense: number;
} {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    const amt = Number(t.amount) || 0;
    if (t.transactionType === "Income") income += amt;
    else if (t.transactionType === "Expense") expense += amt;
  }
  return { income, expense };
}

export function groupSumBy(
  transactions: Transaction[],
  keyFn: (t: Transaction) => string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of transactions) {
    const k = keyFn(t);
    out[k] = (out[k] ?? 0) + (Number(t.amount) || 0);
  }
  return out;
}

export function expensesByCategory(
  transactions: Transaction[],
): Record<string, number> {
  return groupSumBy(expensesOnly(transactions), (t) => t.category);
}

export function expensesByPaymentMethod(
  transactions: Transaction[],
): Record<string, number> {
  return groupSumBy(expensesOnly(transactions), (t) => t.paymentMethod);
}

export function expensesByDay(
  transactions: Transaction[],
): Record<string, number> {
  return groupSumBy(expensesOnly(transactions), (t) => t.transactionDate);
}

export function expensesByMonth(
  transactions: Transaction[],
): Record<string, number> {
  return groupSumBy(expensesOnly(transactions), (t) =>
    normalizeMonthKey(t.transactionDate),
  );
}

export function expensesByYear(
  transactions: Transaction[],
): Record<string, number> {
  return groupSumBy(expensesOnly(transactions), (t) =>
    String(new Date(t.transactionDate).getUTCFullYear()),
  );
}

// ISO-ish week key: Monday-based week start -> "YYYY-Www".
export function weekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day);
  const year = monday.getUTCFullYear();
  // week number within year
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const week = Math.floor(
    (monday.getTime() - startOfYear.getTime()) / (7 * 86400000),
  ) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function expensesByWeek(
 transactions: Transaction[],
): Record<string, number> {
  return groupSumBy(expensesOnly(transactions), (t) => weekKey(t.transactionDate));
}

export function highestSpendingCategory(
  transactions: Transaction[],
): { category: string; total: number } | null {
  const byCat = expensesByCategory(transactions);
  let best: { category: string; total: number } | null = null;
  for (const [category, total] of Object.entries(byCat)) {
    if (!best || total > best.total) best = { category, total };
  }
  return best;
}

export function largestTransaction(
  transactions: Transaction[],
): Transaction | null {
  let best: Transaction | null = null;
  for (const t of transactions) {
    if (!best || Number(t.amount) > Number(best.amount)) best = t;
  }
  return best;
}

// Continuous monthly totals across the observed span, filling missing months
// with 0 so the time series is gapless (required for LSTM forecasting).
export function continuousMonthlyExpenses(
  transactions: Transaction[],
  opts?: { startDate?: string; endDate?: string },
): { month: string; total: number }[] {
  const byMonth = expensesByMonth(transactions);
  const dates = transactions.map((t) => t.transactionDate).filter(Boolean);
  if (dates.length === 0 && !opts?.startDate && !opts?.endDate) return [];

  let start: Date;
  let end: Date;
  if (opts?.startDate && opts?.endDate) {
    start = new Date(opts.startDate);
    end = new Date(opts.endDate);
  } else if (dates.length) {
    const sorted = [...dates].sort();
    start = new Date(sorted[0]);
    end = new Date(sorted[sorted.length - 1]);
  } else {
    return [];
  }

  const out: { month: string; total: number }[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    const key = normalizeMonthKey(cursor);
    out.push({ month: key, total: byMonth[key] ?? 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export function monthlyIncomeExpense(
  transactions: Transaction[],
): { month: string; income: number; expense: number }[] {
  const inc = groupSumBy(
    transactions.filter(isIncome),
    (t) => normalizeMonthKey(t.transactionDate),
  );
  const exp = expensesByMonth(transactions);
  const months = new Set([...Object.keys(inc), ...Object.keys(exp)]);
  return [...months]
    .sort()
    .map((month) => ({
      month,
      income: inc[month] ?? 0,
      expense: exp[month] ?? 0,
    }));
}

export function netCashFlow(income: number, expense: number): number {
  return income - expense;
}

export function savingsRate(income: number, expense: number): number | null {
  if (income <= 0) return null; // undefined when no income
  return ((income - expense) / income) * 100;
}

export function monthOverMonthChange(
  monthlyExpenses: number[],
): number | null {
  if (monthlyExpenses.length < 2) return null;
  const prev = monthlyExpenses[monthlyExpenses.length - 2];
  const last = monthlyExpenses[monthlyExpenses.length - 1];
  if (prev === 0) return null;
  return ((last - prev) / prev) * 100;
}

export function averageDailySpend(
  transactions: Transaction[],
  rangeDays?: number,
): number {
  const exp = expensesOnly(transactions);
  const total = sumAmounts(exp);
  let days = rangeDays;
  if (!days) {
    const dates = exp.map((t) => t.transactionDate).filter(Boolean).sort();
    if (dates.length < 2) days = dates.length;
    else {
      const start = new Date(dates[0]).getTime();
      const end = new Date(dates[dates.length - 1]).getTime();
      days = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
    }
  }
  return days && days > 0 ? total / days : 0;
}

export function averageMonthlySpend(
  monthlyExpenses: { month: string; total: number }[],
): number {
  if (!monthlyExpenses.length) return 0;
  return (
    monthlyExpenses.reduce((a, m) => a + m.total, 0) / monthlyExpenses.length
  );
}

export interface AnalyticsSummary {
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  savingsRate: number | null;
  byCategory: { category: string; total: number }[];
  byPaymentMethod: { method: string; total: number }[];
  byMonth: { month: string; income: number; expense: number }[];
  byDay: { date: string; total: number }[];
  byWeek: { week: string; total: number }[];
  byYear: { year: string; total: number }[];
  highestCategory: { category: string; total: number } | null;
  largest: Transaction | null;
  momChange: number | null;
  avgDaily: number;
  avgMonthly: number;
  transactionCount: number;
}

export function computeAnalytics(
  transactions: Transaction[],
  opts?: { startDate?: string; endDate?: string },
): AnalyticsSummary {
  const exp = expensesOnly(transactions);
  const { income, expense } = totalsByType(transactions);

  const byCat = expensesByCategory(transactions);
  const byCatArr = Object.entries(byCat)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);

  const byPay = expensesByPaymentMethod(transactions);
  const byPayArr = Object.entries(byPay)
    .map(([method, total]) => ({ method, total }))
    .sort((a, b) => b.total - a.total);

  const byDayMap = expensesByDay(transactions);
  const byDay = Object.entries(byDayMap)
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byWeekMap = expensesByWeek(transactions);
  const byWeek = Object.entries(byWeekMap)
    .map(([week, total]) => ({ week, total }))
    .sort((a, b) => a.week.localeCompare(b.week));

  const byYearMap = expensesByYear(transactions);
  const byYear = Object.entries(byYearMap)
    .map(([year, total]) => ({ year, total }))
    .sort((a, b) => a.year.localeCompare(b.year));

  const continuous = continuousMonthlyExpenses(transactions, opts);
  const monthly = monthlyIncomeExpense(transactions);

  return {
    totalIncome: income,
    totalExpenses: expense,
    netCashFlow: netCashFlow(income, expense),
    savingsRate: savingsRate(income, expense),
    byCategory: byCatArr,
    byPaymentMethod: byPayArr,
    byMonth: monthly,
    byDay,
    byWeek,
    byYear,
    highestCategory: highestSpendingCategory(transactions),
    largest: largestTransaction(exp), // largest EXPENSE, not income
    momChange: monthOverMonthChange(continuous.map((m) => m.total)),
    avgDaily: averageDailySpend(transactions),
    avgMonthly: averageMonthlySpend(continuous),
    transactionCount: transactions.length,
  };
}
