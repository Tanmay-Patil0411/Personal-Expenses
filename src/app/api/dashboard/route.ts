import { NextResponse } from "next/server";
import { gatherDashboard } from "@/lib/aggregate";
import { getSessionUser } from "@/lib/auth";
import type { TransactionFilters } from "@/lib/transactionService";
import type { TransactionType } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const sp = url.searchParams;
    const filters: TransactionFilters = {};
    if (sp.get("startDate")) filters.startDate = sp.get("startDate")!;
    if (sp.get("endDate")) filters.endDate = sp.get("endDate")!;
    if (sp.get("type")) filters.type = sp.get("type") as TransactionType;
    if (sp.get("category")) filters.category = sp.get("category")!;
    if (sp.get("paymentMethod")) filters.paymentMethod = sp.get("paymentMethod")!;

    const data = await gatherDashboard(filters, user.id);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
