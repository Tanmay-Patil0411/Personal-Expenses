import { DEFAULT_SETTINGS } from "./config";

// Currency / date formatting helpers. Reads the configured currency and
// locale so the whole application renders consistent values.

let cachedCurrency: string = DEFAULT_SETTINGS.currency;
let cachedLocale: string = DEFAULT_SETTINGS.locale;

export function configureFormatting(currency: string, locale: string) {
  cachedCurrency = currency || DEFAULT_SETTINGS.currency;
  cachedLocale = locale || DEFAULT_SETTINGS.locale;
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat(cachedLocale, {
    style: "currency",
    currency: cachedCurrency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat(cachedLocale, {
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(cachedLocale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat(cachedLocale, {
    year: "numeric",
    month: "short",
  }).format(d);
}
