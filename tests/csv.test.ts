import { describe, expect, it } from "vitest";
import {
  parseCsv,
  validateCsv,
  buildCsvTemplate,
  transactionsToCsv,
} from "@/lib/csvService";
import type { Transaction } from "@/lib/types";

describe("csv import/export validation", () => {
  const csv = [
    "transaction_date,transaction_type,amount,category,payment_method,description,external_transaction_id",
    "2025-01-05,Expense,12.50,Food,Credit Card,Lunch,EXT-1",
    "2025-01-31,Income,3000,Salary,Bank Transfer,Salary,EXT-2",
    "2025-02-01,Expense,0,Food,Cash,Zero amount,EXT-3",
    "bad-date,Expense,10,Food,Cash,Bad date,EXT-4",
  ].join("\n");

  it("parses CSV with quoted fields", () => {
    const parsed = parseCsv('a,b,c\n1,2,"3,4"');
    expect(parsed).toEqual([["a", "b", "c"], ["1", "2", "3,4"]]);
  });

  it("validates rows and reports invalid reasons", () => {
    const parsed = parseCsv(csv);
    const result = validateCsv(parsed);
    expect(result.total).toBe(4);
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(2);
    expect(result.errors.some((e) => e.reason.includes("amount"))).toBe(true);
    expect(result.errors.some((e) => e.reason.includes("date"))).toBe(true);
  });

  it("detects duplicates via external_transaction_id", () => {
    const parsed = parseCsv(csv);
    const existing = new Set(["EXT-1"]);
    const result = validateCsv(parsed, existing);
    expect(result.duplicateCount).toBe(1);
    expect(result.duplicateRows).toContain(1);
  });

  it("detects internal duplicates in the same file", () => {
    const dup = [
      "transaction_date,transaction_type,amount,category,payment_method,description,external_transaction_id",
      "2025-01-05,Expense,10,Food,Cash,x,EXT-A",
      "2025-01-06,Expense,10,Food,Cash,y,EXT-A",
    ].join("\n");
    const result = validateCsv(parseCsv(dup));
    expect(result.duplicateCount).toBe(1);
  });

  it("provides a downloadable template", () => {
    const template = buildCsvTemplate();
    expect(template).toContain("transaction_date");
    expect(template).toContain("external_transaction_id");
  });

  it("exports transactions to CSV", () => {
    const txns: Transaction[] = [
      {
        id: 1,
        transactionDate: "2025-01-05",
        transactionType: "Expense",
        amount: 12.5,
        category: "Food",
        paymentMethod: "Cash",
        description: 'Lunch "special"',
        externalTransactionId: "E1",
      },
    ];
    const out = transactionsToCsv(txns);
    expect(out).toContain("2025-01-05");
    expect(out).toContain('"Lunch ""special"""');
  });

  it("rejects csv missing required columns", () => {
    const bad = parseCsv("foo,bar\n1,2");
    const result = validateCsv(bad);
    expect(result.errors[0].reason).toContain("Missing required columns");
  });
});
