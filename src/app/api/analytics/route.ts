import { NextResponse } from "next/server";
import { getTransactions } from "@/lib/transactionService";
import { computeAnalytics } from "@/lib/analytics";
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

  const txns = await getTransactions(filters);
  const analytics = computeAnalytics(txns, {
    startDate: filters.startDate,
    endDate: filters.endDate,
  });
  return NextResponse.json({ analytics, count: txns.length });
}
