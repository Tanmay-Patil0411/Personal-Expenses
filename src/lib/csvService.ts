import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  type Transaction,
  type TransactionType,
} from "./types";

// ---------------------------------------------------------------------------
// Minimal RFC-4180-ish CSV parser supporting quoted fields and commas.
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // last field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully empty trailing rows
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
}

export interface CsvTransactionInput {
  transactionDate: string;
  transactionType: TransactionType;
  amount: number;
  category: string;
  paymentMethod: string;
  description: string;
  externalTransactionId: string;
}

export interface CsvRowError {
  row: number; // 1-based data row (excluding header)
  reason: string;
}

export interface CsvValidationResult {
  header: string[];
  columnMap: Record<string, number>;
  total: number;
  valid: CsvTransactionInput[];
  errors: CsvRowError[];
  duplicateRows: number[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
}

const HEADER_ALIASES: Record<string, string> = {
  // Dates
  transaction_date: "transaction_date",
  date: "transaction_date",
  trans_date: "transaction_date",
  timestamp: "transaction_date",
  datetime: "transaction_date",

  // Type
  transaction_type: "transaction_type",
  type: "transaction_type",
  income_expense: "transaction_type",
  income_or_expense: "transaction_type",
  "income/expense": "transaction_type",
  incomeexpense: "transaction_type",
  trans_type: "transaction_type",
  txn_type: "transaction_type",

  // Amount
  amount: "amount",
  cost: "amount",
  total: "amount",
  value: "amount",
  price: "amount",

  // Category
  category: "category",
  cat: "category",

  // Payment Method
  payment_method: "payment_method",
  paymentmode: "payment_method",
  payment_mode: "payment_method",
  mode: "payment_method",
  method: "payment_method",
  payment: "payment_method",
  account: "payment_method",

  // Description
  description: "description",
  merchant: "description",
  note: "description",
  notes: "description",
  memo: "description",
  details: "description",
  subcategory: "description",

  // External ID
  external_transaction_id: "external_transaction_id",
  externalid: "external_transaction_id",
  id: "external_transaction_id",
  reference: "external_transaction_id",
};

export function normalizeHeader(h: string): string {
  const trimmed = h.trim().toLowerCase();
  if (HEADER_ALIASES[trimmed]) return HEADER_ALIASES[trimmed];
  const cleaned = trimmed.replace(/[\s_-]+/g, "_");
  if (HEADER_ALIASES[cleaned]) return HEADER_ALIASES[cleaned];
  const slashCleaned = trimmed.replace(/[\s/_-]+/g, "_");
  if (HEADER_ALIASES[slashCleaned]) return HEADER_ALIASES[slashCleaned];
  const noSpecial = trimmed.replace(/[^a-z0-9]/g, "");
  if (HEADER_ALIASES[noSpecial]) return HEADER_ALIASES[noSpecial];
  return "";
}

export function parseAndNormalizeDate(rawDate: string): string | null {
  if (!rawDate) return null;
  const clean = rawDate.trim().split(" ")[0]; // Strip time component

  // 1. YYYY-MM-DD or YYYY/MM/DD
  const ymd = clean.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, "0");
    const d = ymd[3].padStart(2, "0");
    const iso = `${y}-${m}-${d}`;
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
  }

  // 2. DD/MM/YYYY or MM/DD/YYYY
  const dmy = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const part1 = parseInt(dmy[1], 10);
    const part2 = parseInt(dmy[2], 10);
    const y = dmy[3];

    // If part1 > 12, part1 is day, part2 is month (DD/MM/YYYY)
    if (part1 > 12 && part2 <= 12) {
      const iso = `${y}-${String(part2).padStart(2, "0")}-${String(part1).padStart(2, "0")}`;
      return Number.isNaN(new Date(iso).getTime()) ? null : iso;
    }
    // If part2 > 12, part2 is day, part1 is month (MM/DD/YYYY)
    if (part2 > 12 && part1 <= 12) {
      const iso = `${y}-${String(part1).padStart(2, "0")}-${String(part2).padStart(2, "0")}`;
      return Number.isNaN(new Date(iso).getTime()) ? null : iso;
    }
    // Default assumption for international / Indian datasets is DD/MM/YYYY
    const iso = `${y}-${String(part2).padStart(2, "0")}-${String(part1).padStart(2, "0")}`;
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
  }

  const parsed = new Date(rawDate);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export function normalizeTransactionType(
  rawType: string,
): TransactionType | null {
  const t = rawType.trim().toLowerCase();
  if (
    t.includes("expense") ||
    t === "debit" ||
    t === "dr" ||
    t === "out" ||
    t.includes("transfer-out")
  ) {
    return "Expense";
  }
  if (
    t.includes("income") ||
    t === "credit" ||
    t === "cr" ||
    t === "in" ||
    t.includes("salary") ||
    t.includes("transfer-in")
  ) {
    return "Income";
  }
  return null;
}

export function normalizeCategory(
  rawCat: string,
  type: TransactionType,
): string {
  const lower = (rawCat || "").trim().toLowerCase();

  if (type === "Expense") {
    const exact = EXPENSE_CATEGORIES.find((cat) => cat.toLowerCase() === lower);
    if (exact) return exact;

    if (
      lower.includes("food") ||
      lower.includes("din") ||
      lower.includes("restaurant") ||
      lower.includes("snack") ||
      lower.includes("cafe")
    ) {
      return "Food";
    }
    if (
      lower.includes("groc") ||
      lower.includes("supermarket") ||
      lower.includes("vegetable") ||
      lower.includes("fruit")
    ) {
      return "Groceries";
    }
    if (
      lower.includes("transport") ||
      lower.includes("travel") ||
      lower.includes("fuel") ||
      lower.includes("gas") ||
      lower.includes("metro") ||
      lower.includes("train") ||
      lower.includes("auto") ||
      lower.includes("cab") ||
      lower.includes("uber")
    ) {
      return "Transport";
    }
    if (
      lower.includes("shop") ||
      lower.includes("apparel") ||
      lower.includes("cloth") ||
      lower.includes("shoe") ||
      lower.includes("fashion") ||
      lower.includes("electronic")
    ) {
      return "Shopping";
    }
    if (
      lower.includes("educat") ||
      lower.includes("book") ||
      lower.includes("course") ||
      lower.includes("tuition") ||
      lower.includes("school")
    ) {
      return "Education";
    }
    if (
      lower.includes("health") ||
      lower.includes("medic") ||
      lower.includes("pharmacy") ||
      lower.includes("doctor") ||
      lower.includes("hospital")
    ) {
      return "Healthcare";
    }
    if (
      lower.includes("house") ||
      lower.includes("rent") ||
      lower.includes("flat") ||
      lower.includes("mortgage") ||
      lower.includes("home")
    ) {
      return "Housing";
    }
    if (
      lower.includes("utilit") ||
      lower.includes("electric") ||
      lower.includes("water") ||
      lower.includes("bill") ||
      lower.includes("recharge") ||
      lower.includes("power")
    ) {
      return "Utilities";
    }
    if (
      lower.includes("entertain") ||
      lower.includes("movie") ||
      lower.includes("cinema") ||
      lower.includes("game") ||
      lower.includes("social")
    ) {
      return "Entertainment";
    }
    if (
      lower.includes("subscript") ||
      lower.includes("netflix") ||
      lower.includes("spotify") ||
      lower.includes("prime")
    ) {
      return "Subscriptions";
    }
    if (
      lower.includes("tour") ||
      lower.includes("trip") ||
      lower.includes("flight") ||
      lower.includes("hotel")
    ) {
      return "Travel";
    }
    if (
      lower.includes("beauty") ||
      lower.includes("salon") ||
      lower.includes("care") ||
      lower.includes("personal") ||
      lower.includes("self")
    ) {
      return "Personal Care";
    }
    return "Other";
  } else {
    const exact = INCOME_CATEGORIES.find((cat) => cat.toLowerCase() === lower);
    if (exact) return exact;

    if (
      lower.includes("salar") ||
      lower.includes("wage") ||
      lower.includes("paycheck")
    ) {
      return "Salary";
    }
    if (lower.includes("allowan") || lower.includes("pocket")) {
      return "Allowance";
    }
    if (lower.includes("freelanc") || lower.includes("consult")) {
      return "Freelance";
    }
    if (lower.includes("business") || lower.includes("sales")) {
      return "Business";
    }
    if (
      lower.includes("invest") ||
      lower.includes("dividend") ||
      lower.includes("interest") ||
      lower.includes("profit")
    ) {
      return "Investment Income";
    }
    if (
      lower.includes("gift") ||
      lower.includes("reward") ||
      lower.includes("bonus")
    ) {
      return "Gift";
    }
    return "Other";
  }
}

export function normalizePaymentMethod(rawMethod: string): string {
  const m = (rawMethod || "").trim().toLowerCase();
  const exact = PAYMENT_METHODS.find((pm) => pm.toLowerCase() === m);
  if (exact) return exact;

  if (m.includes("cash")) return "Cash";
  if (m.includes("credit")) return "Credit Card";
  if (m.includes("debit")) return "Debit Card";
  if (
    m.includes("upi") ||
    m.includes("gpay") ||
    m.includes("phonepe") ||
    m.includes("paytm")
  ) {
    return "UPI";
  }
  if (
    m.includes("bank") ||
    m.includes("saving") ||
    m.includes("transfer") ||
    m.includes("neft") ||
    m.includes("rtgs") ||
    m.includes("imps") ||
    m.includes("account")
  ) {
    return "Bank Transfer";
  }
  if (m.includes("wallet")) return "Wallet";
  return "Other";
}

export function buildColumnMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, idx) => {
    const key = normalizeHeader(h);
    if (key) map[key] = idx;
  });
  return map;
}

export function validateCsv(
  parsed: string[][],
  existingExternalIds: Set<string> = new Set(),
): CsvValidationResult {
  const header = parsed[0] ?? [];
  const data = parsed.slice(1);
  const columnMap = buildColumnMap(header);

  const required = [
    "transaction_date",
    "transaction_type",
    "amount",
    "category",
    "payment_method",
  ];
  const missing = required.filter((r) => columnMap[r] === undefined);

  const valid: CsvTransactionInput[] = [];
  const errors: CsvRowError[] = [];
  const duplicateRows: number[] = [];
  const seenExternal = new Set<string>();

  if (missing.length > 0) {
    return {
      header,
      columnMap,
      total: data.length,
      valid,
      errors: [
        {
          row: 0,
          reason: `Missing required columns: ${missing.join(", ")}`,
        },
      ],
      duplicateRows,
      validCount: 0,
      invalidCount: data.length,
      duplicateCount: 0,
    };
  }

  data.forEach((cols, idx) => {
    const rowNum = idx + 1;
    const get = (key: string) => {
      const i = columnMap[key];
      return i === undefined ? "" : (cols[i] ?? "").trim();
    };
    const rawDate = get("transaction_date");
    const rawType = get("transaction_type");
    const rawAmount = get("amount");
    const rawCategory = get("category");
    const rawMethod = get("payment_method");
    const description = get("description");
    const external = get("external_transaction_id");

    const date = parseAndNormalizeDate(rawDate);
    if (!date) {
      errors.push({ row: rowNum, reason: `Invalid date: "${rawDate}"` });
      return;
    }

    const type = normalizeTransactionType(rawType);
    if (!type) {
      errors.push({
        row: rowNum,
        reason: `Invalid type: "${rawType}" (must be Income/Expense)`,
      });
      return;
    }

    const amountClean = rawAmount.replace(/[^0-9.-]+/g, "");
    const amount = Number(amountClean);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ row: rowNum, reason: `Invalid amount: "${rawAmount}"` });
      return;
    }

    const category = normalizeCategory(rawCategory, type);
    const method = normalizePaymentMethod(rawMethod);

    // Duplicate handling
    if (external) {
      if (seenExternal.has(external) || existingExternalIds.has(external)) {
        duplicateRows.push(rowNum);
        return;
      }
      seenExternal.add(external);
    }

    valid.push({
      transactionDate: date,
      transactionType: type,
      amount,
      category,
      paymentMethod: method,
      description: description ?? "",
      externalTransactionId: external ?? "",
    });
  });

  return {
    header,
    columnMap,
    total: data.length,
    valid,
    errors,
    duplicateRows,
    validCount: valid.length,
    invalidCount: errors.length,
    duplicateCount: duplicateRows.length,
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export const CSV_TEMPLATE_HEADER =
  "transaction_date,transaction_type,amount,category,payment_method,description,external_transaction_id";

export function buildCsvTemplate(): string {
  const sample = [
    "2025-01-05,Expense,12.50,Food,Credit Card,Lunch at cafe,EXT-0001",
    "2025-01-31,Income,3200.00,Salary,Bank Transfer,January salary,EXT-0002",
  ];
  return [CSV_TEMPLATE_HEADER, ...sample].join("\n");
}

export function transactionsToCsv(transactions: Transaction[]): string {
  const lines = [CSV_TEMPLATE_HEADER];
  for (const t of transactions) {
    const cells = [
      t.transactionDate,
      t.transactionType,
      String(t.amount),
      t.category,
      t.paymentMethod,
      `"${(t.description ?? "").replace(/"/g, '""')}"`,
      t.externalTransactionId ?? "",
    ];
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}
