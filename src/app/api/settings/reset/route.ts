import { NextResponse } from "next/server";
import {
  clearAllTransactions,
  countTransactions,
} from "@/lib/transactionService";
import { clearBudgets } from "@/lib/budgetService";
import { saveSettings, getSettings } from "@/lib/settingsService";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Destructive reset — only invoked after explicit UI confirmation.
export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deleted = await clearAllTransactions(user.id);
    await clearBudgets(user.id);
    const current = await getSettings(user.id);
    await saveSettings({ ...current, datasetMode: "real" }, user.id);
    const remaining = await countTransactions(user.id);
    return NextResponse.json({ ok: true, deleted, remaining });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
