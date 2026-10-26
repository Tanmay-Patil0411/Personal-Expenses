import { NextResponse } from "next/server";
import { getTransactions } from "@/lib/transactionService";
import { transactionsToCsv } from "@/lib/csvService";
import { getSessionUser } from "@/lib/auth";
import type { TransactionFilters } from "@/lib/transactionService";
import type { TransactionType } from "@/lib/types";

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

  const txns = await getTransactions(filters);
  const csv = transactionsToCsv(txns);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="transactions_export.csv"',
    },
  });
}
