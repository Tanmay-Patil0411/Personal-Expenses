import type { Transaction } from "@/lib/types";
import { normalizeMonthKey } from "@/lib/config";

export class InsufficientDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientDataError";
  }
}

export interface MonthlyExpenseDataset {
  series: number[];
  monthKeys: string[];
  startDate: string; // YYYY-MM-01
  endDate: string; // YYYY-MM-DD
  totalTransactions: number;
  distinctMonthsCount: number;
  currentCalendarMonth: string;
  completedMonthKeys: string[];
  completedSeries: number[];
  currentMonthTotal: number;
  hasCurrentMonth: boolean;
  hasCompletedMonths: boolean;
}

// Build a continuous, gapless monthly expense series (oldest -> newest) from
// transactions. Missing months are filled with 0 so the time series is
// mathematically contiguous and strictly aligned with monthKeys.
// Separates completed historical months (< currentCalendarMonth) from the current
// ongoing month (== currentCalendarMonth).
export function buildMonthlyExpenseDataset(
  transactions: Transaction[],
  referenceDate: Date = new Date(),
): MonthlyExpenseDataset {
  const currentCalendarMonth = normalizeMonthKey(referenceDate);
  const byMonth: Record<string, number> = {};
  let count = 0;

  for (const t of transactions) {
    if (t.transactionType !== "Expense") continue; // never count income in expense prediction
    const amt = Number(t.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    const key = normalizeMonthKey(t.transactionDate);
    byMonth[key] = (byMonth[key] ?? 0) + amt;
    count++;
  }

  const currentMonthTotal = byMonth[currentCalendarMonth] ?? 0;
  const hasCurrentMonth = currentMonthTotal > 0;
  const distinctKeys = Object.keys(byMonth).sort();

  if (distinctKeys.length === 0) {
    return {
      series: [],
      monthKeys: [],
      startDate: "",
      endDate: "",
      totalTransactions: 0,
      distinctMonthsCount: 0,
      currentCalendarMonth,
      completedMonthKeys: [],
      completedSeries: [],
      currentMonthTotal: 0,
      hasCurrentMonth: false,
      hasCompletedMonths: false,
    };
  }

  const [startYear, startMonth] = distinctKeys[0].split("-").map(Number);
  const [endYear, endMonth] = distinctKeys[distinctKeys.length - 1]
    .split("-")
    .map(Number);

  const series: number[] = [];
  const monthKeys: string[] = [];

  let curY = startYear;
  let curM = startMonth;

  while (curY < endYear || (curY === endYear && curM <= endMonth)) {
    const key = `${curY}-${String(curM).padStart(2, "0")}`;
    monthKeys.push(key);
    series.push(byMonth[key] ?? 0);

    curM++;
    if (curM > 12) {
      curM = 1;
      curY++;
    }
  }

  const lastKey = monthKeys[monthKeys.length - 1];
  const [ly, lm] = lastKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(ly, lm, 0)).getUTCDate();

  // Completed months are strictly those strictly preceding the current calendar month
  const completedMonthKeys: string[] = [];
  const completedSeries: number[] = [];

  for (let i = 0; i < monthKeys.length; i++) {
    const k = monthKeys[i];
    if (k < currentCalendarMonth) {
      completedMonthKeys.push(k);
      completedSeries.push(series[i]);
    }
  }

  return {
    series,
    monthKeys,
    startDate: `${monthKeys[0]}-01`,
    endDate: `${lastKey}-${String(lastDay).padStart(2, "0")}`,
    totalTransactions: count,
    distinctMonthsCount: distinctKeys.length,
    currentCalendarMonth,
    completedMonthKeys,
    completedSeries,
    currentMonthTotal,
    hasCurrentMonth,
    hasCompletedMonths: completedMonthKeys.length > 0,
  };
}

export function buildMonthlySeries(transactions: Transaction[]): number[] {
  return buildMonthlyExpenseDataset(transactions).series;
}

export function monthKeysFromSeries(transactions: Transaction[]): string[] {
  return buildMonthlyExpenseDataset(transactions).monthKeys;
}

export interface SeriesSplit {
  train: number[];
  val: number[];
  test: number[];
}

// Chronological partition boundaries of the raw series.
// Train = all months except the trailing (valMonths + testMonths); val/test
// are the most recent windows. Ordering is preserved — no shuffling.
export function splitSeries(
  series: number[],
  seqLen: number,
  valMonths: number,
  testMonths: number,
): SeriesSplit {
  const n = series.length;
  const minTotal = seqLen + 1 + valMonths + testMonths;
  if (n < minTotal) {
    throw new InsufficientDataError(
      `Need at least ${minTotal} months of data (got ${n}).`,
    );
  }
  const testStart = n - testMonths;
  const valStart = testStart - valMonths;
  return {
    train: series.slice(0, valStart),
    val: series.slice(valStart, testStart),
    test: series.slice(testStart),
  };
}

export type Partition = "train" | "val" | "test";

// Build sliding-window sequences. Each target index i >= seqLen is assigned
// to train/val/test based on chronological position of its TARGET month —
// the preceding lookback window may cross partition boundaries, which is the
// standard time-series setup and does not use future values as inputs.
export function buildSplitSequences(
  scaledSeries: number[],
  seqLen: number,
  valMonths: number,
  testMonths: number,
): {
  train: { xs: number[][]; ys: number[] };
  val: { xs: number[][]; ys: number[] };
  test: { xs: number[][]; ys: number[] };
} {
  const n = scaledSeries.length;
  if (n < seqLen + 1 + valMonths + testMonths) {
    throw new InsufficientDataError(
      `Need at least ${seqLen + 1 + valMonths + testMonths} months of data (got ${n}).`,
    );
  }
  const trainEnd = n - valMonths - testMonths; // last train target index (excl)
  const testStart = n - testMonths;

  const train = { xs: [] as number[][], ys: [] as number[] };
  const val = { xs: [] as number[][], ys: [] as number[] };
  const test = { xs: [] as number[][], ys: [] as number[] };

  for (let i = seqLen; i < n; i++) {
    const window = scaledSeries.slice(i - seqLen, i);
    const target = scaledSeries[i];
    if (i < trainEnd) {
      train.xs.push(window);
      train.ys.push(target);
    } else if (i < testStart) {
      val.xs.push(window);
      val.ys.push(target);
    } else {
      test.xs.push(window);
      test.ys.push(target);
    }
  }
  if (train.xs.length === 0) {
    throw new InsufficientDataError("Training partition produced no sequences.");
  }
  return { train, val, test };
}

// Build sliding-window sequences from a scaled series (utility for tests).
export function buildSequences(
  scaled: number[],
  seqLen: number,
): { xs: number[][]; ys: number[] } {
  const xs: number[][] = [];
  const ys: number[] = [];
  for (let i = 0; i + seqLen < scaled.length; i++) {
    xs.push(scaled.slice(i, i + seqLen));
    ys.push(scaled[i + seqLen]);
  }
  return { xs, ys };
}
