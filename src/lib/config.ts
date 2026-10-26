// Centralised configuration + default application settings.
// These defaults are persisted into the app_settings table on first run and
// can be changed from the Settings page.

export const DEFAULT_SETTINGS = {
  currency: "INR",
  locale: "en-IN",
  warningThreshold: 80, // % utilization that triggers a warning
  sequenceLength: 6, // LSTM lookback window (months)
  forecastHorizon: 1, // months ahead to forecast
  epochs: 80,
  batchSize: 8,
  validationSplit: 0.2,
  testMonths: 3, // chronological test window
  valMonths: 3, // chronological validation window
  datasetMode: "real" as string, // real | demo
  modelVersion: "lstm-v1",
} as const;

export type AppSettings = typeof DEFAULT_SETTINGS;

export const SETTINGS_KEY = "app_settings";

// Minimum number of monthly observations required to build a single
// training sequence plus a validation and test window.
// Need: sequenceLength (lookback) + 1 (first target) + valMonths + testMonths
export function minRequiredMonths(seqLen: number): number {
  return seqLen + 1 + 3 + 3; // seqLen + target + 3 val + 3 test
}

export function normalizeMonthKey(d: Date | string): string {
  if (typeof d === "string") {
    const m = d.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
  }
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthKeyFromParts(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12;
  return monthKeyFromParts(ny, nm);
}

export function nextMonth(monthKey: string): string {
  return addMonths(monthKey, 1);
}

export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [y, m] = monthKey.split("-").map(Number);
  return { year: y, month: m };
}

export function getDaysInMonth(year: number, month1Indexed: number): number {
  return new Date(year, month1Indexed, 0).getDate();
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function getMonthName(month1Indexed: number): string {
  return MONTH_NAMES[(month1Indexed - 1 + 12) % 12] ?? "Unknown";
}

export function lastDayOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${monthKey}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

