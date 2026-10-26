import { NextResponse } from "next/server";
import { parseCsv, validateCsv } from "@/lib/csvService";
import {
  createTransaction,
  findExistingExternalIds,
} from "@/lib/transactionService";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { text } = (await req.json()) as { text?: string };
    if (!text || !text.trim()) {
      return NextResponse.json(
        { ok: false, error: "No CSV text provided." },
        { status: 400 },
      );
    }
    const parsed = parseCsv(text);
    const externalIds = parsed
      .slice(1)
      .map((cols) => {
        const idx = parsed[0]
          .map((h) => h.trim().toLowerCase())
          .indexOf("external_transaction_id");
        return idx >= 0 ? (cols[idx] ?? "").trim() : "";
      })
      .filter(Boolean);
    const existing = await findExistingExternalIds(externalIds, user.id);
    const result = validateCsv(parsed, existing);

    let imported = 0;
    const failures: string[] = [];
    for (const row of result.valid) {
      try {
        await createTransaction(
          {
            transactionDate: row.transactionDate,
            transactionType: row.transactionType,
            amount: row.amount,
            category: row.category,
            paymentMethod: row.paymentMethod,
            description: row.description || null,
            externalTransactionId: row.externalTransactionId || null,
          },
          user.id,
        );
        imported++;
      } catch (e) {
        failures.push(
          e instanceof Error ? e.message : "Failed to insert row",
        );
      }
    }

    return NextResponse.json({
      ok: true,
      imported,
      invalid: result.invalidCount,
      duplicates: result.duplicateCount,
      failures,
      summary: {
        total: result.total,
        valid: result.validCount,
        invalid: result.invalidCount,
        duplicates: result.duplicateCount,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
