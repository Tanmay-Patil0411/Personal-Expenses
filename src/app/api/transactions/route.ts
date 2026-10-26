import { NextResponse } from "next/server";
import {
  createTransaction,
  getTransactions,
  type TransactionFilters,
} from "@/lib/transactionService";
import { getSessionUser } from "@/lib/auth";
import type { TransactionInput, TransactionType } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sp = url.searchParams;
  const filters: TransactionFilters = {
    userId: user.id,
  };
  if (sp.get("startDate")) filters.startDate = sp.get("startDate")!;
  if (sp.get("endDate")) filters.endDate = sp.get("endDate")!;
  if (sp.get("type")) filters.type = sp.get("type") as TransactionType;
  if (sp.get("category")) filters.category = sp.get("category")!;
  if (sp.get("paymentMethod")) filters.paymentMethod = sp.get("paymentMethod")!;
  if (sp.get("search")) filters.search = sp.get("search")!;
  if (sp.get("sortBy")) filters.sortBy = sp.get("sortBy") as "date" | "amount";
  if (sp.get("sortDir")) filters.sortDir = sp.get("sortDir") as "asc" | "desc";

  const rows = await getTransactions(filters);
  return NextResponse.json({ count: rows.length, transactions: rows });
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as TransactionInput;
    const created = await createTransaction(body, user.id);
    return NextResponse.json({ ok: true, transaction: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
