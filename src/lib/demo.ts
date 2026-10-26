import { createTransaction, clearAllTransactions } from "./transactionService";
import { saveSettings, getSettings } from "./settingsService";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  type TransactionInput,
} from "./types";

// Deterministic PRNG so the demonstration dataset is reproducible.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticOptions {
  months?: number;
  seed?: number;
  startYear?: number;
  startMonth?: number; // 1-12
}

// Default start date: (months-1) months before the current month so the
// synthetic dataset ENDS in the current month (live dashboards/insights).
function defaultStart(months: number): { startYear: number; startMonth: number } {
  const now = new Date();
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - (months - 1);
  return {
    startYear: Math.floor(total / 12),
    startMonth: (total % 12) + 1,
  };
}

// Produce a reproducible synthetic transaction list (clearly labelled
// demonstration data). Income + multiple expense categories, monthly
// variation, and occasional large expenses.
export function generateSyntheticTransactions(
  opts: SyntheticOptions = {},
): TransactionInput[] {
  const months = opts.months ?? 36;
  const seed = opts.seed ?? 42;
  const rng = mulberry32(seed);
  const def = defaultStart(months);
  const startYear = opts.startYear ?? def.startYear;
  const startMonth = opts.startMonth ?? def.startMonth;

  const rows: TransactionInput[] = [];
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  const baseSalary = 3200;
  const catBase: Record<string, number> = {
    Housing: 900,
    Groceries: 320,
    Food: 180,
    Transport: 120,
    Utilities: 140,
    Subscriptions: 45,
    Shopping: 160,
    Entertainment: 90,
    Healthcare: 60,
    Education: 70,
    Travel: 80,
    "Personal Care": 50,
    Other: 60,
  };

  let counter = 0;
  const ext = (label: string) => `DEMO-${label}-${counter++}`;

  // Stable occurrence counts per category -> learnable monthly structure.
  const occurrences: Record<string, number> = {
    Housing: 1,
    Utilities: 1,
    Subscriptions: 1,
    Groceries: 3,
    Food: 3,
    Transport: 2,
    Shopping: 2,
    Entertainment: 1,
    Healthcare: 1,
    Education: 1,
    Travel: 1,
    "Personal Care": 1,
    Other: 1,
  };

  for (let m = 0; m < months; m++) {
    const total = startYear * 12 + (startMonth - 1) + m;
    const y = Math.floor(total / 12);
    const mo = (total % 12) + 1;
    const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const monthKey = `${y}-${String(mo).padStart(2, "0")}`;
    // Clear month-of-year seasonality + mild long-term growth: these are the
    // signals a time-series model should legitimately learn.
    const seasonal = 1 + 0.3 * Math.sin((mo / 12) * 2 * Math.PI);
    const growth = 1 + 0.004 * m;

    // Income: salary with small variation (occasional freelance).
    const salary = baseSalary * (0.97 + rng() * 0.06) * growth;
    rows.push({
      transactionDate: `${monthKey}-01`,
      transactionType: "Income",
      amount: round2(salary),
      category: "Salary",
      paymentMethod: "Bank Transfer",
      description: "Monthly salary (synthetic)",
      externalTransactionId: ext("SAL"),
    });
    if (rng() > 0.75) {
      rows.push({
        transactionDate: `${monthKey}-${pad(randInt(rng, 5, daysInMonth))}`,
        transactionType: "Income",
        amount: round2(200 + rng() * 400),
        category: "Freelance",
        paymentMethod: "Bank Transfer",
        description: "Freelance project (synthetic)",
        externalTransactionId: ext("FR"),
      });
    }

    // Expenses per category (seasonal + mild noise). Fixed essentials stay
    // flat; discretionary categories swing with the month-of-year factor.
    const flatCategories = new Set(["Housing", "Utilities", "Subscriptions", "Healthcare", "Education"]);
    for (const cat of EXPENSE_CATEGORIES) {
      if (cat === "Travel" && rng() > 0.35) continue; // occasional travel
      const base = (catBase[cat] ?? 60) * (flatCategories.has(cat) ? 1 : seasonal);
      const occ = occurrences[cat] ?? 1;
      for (let k = 0; k < occ; k++) {
        const amount = round2(base * (0.9 + rng() * 0.2) * growth);
        rows.push({
          transactionDate: `${monthKey}-${pad(randInt(rng, 1, daysInMonth))}`,
          transactionType: "Expense",
          amount,
          category: cat,
          paymentMethod: pick(PAYMENT_METHODS),
          description: `${cat} expense (synthetic)`,
          externalTransactionId: ext("EXP"),
        });
      }
    }

    // Rare large expense (anomaly detection demo).
    if (rng() > 0.92) {
      const big = round2(600 + rng() * 900);
      const bigCat = rng() > 0.5 ? "Travel" : "Shopping";
      rows.push({
        transactionDate: `${monthKey}-${pad(randInt(rng, 1, daysInMonth))}`,
        transactionType: "Expense",
        amount: big,
        category: bigCat,
        paymentMethod: pick(PAYMENT_METHODS),
        description: `Large ${bigCat} purchase (synthetic)`,
        externalTransactionId: ext("BIG"),
      });
    }
  }

  return rows;
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Clear existing transactions and seed the DB with synthetic data.
// Returns the number of inserted rows.
export async function seedDemoData(
  opts?: SyntheticOptions,
  userId?: number,
): Promise<{
  inserted: number;
  months: number;
}> {
  const rows = generateSyntheticTransactions(opts);
  await clearAllTransactions(userId);
  let inserted = 0;
  for (const r of rows) {
    await createTransaction(r, userId);
    inserted++;
  }
  const current = await getSettings(userId);
  await saveSettings({ ...current, datasetMode: "demo" }, userId);
  return { inserted, months: opts?.months ?? 36 };
}

