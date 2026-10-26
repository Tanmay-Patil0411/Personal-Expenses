import { NextResponse } from "next/server";
import {
  createBudget,
  getBudgets,
  computeBudgetStatus,
  getBudgetHistory,
  getBudgetPlanningSuggestions,
  duplicateBudgets,
} from "@/lib/budgetService";
import { getSessionUser } from "@/lib/auth";
import type { BudgetInput } from "@/lib/types";
import { getTransactions } from "@/lib/transactionService";
import { normalizeMonthKey, addMonths } from "@/lib/config";
import { getPersonalizedForecast } from "@/ml/pipeline";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? undefined;
  const wantStatus = url.searchParams.get("status") === "1";
  const wantHistory = url.searchParams.get("history") === "1";
  const wantWizard = url.searchParams.get("wizard") === "1";
  const statusFilter = url.searchParams.get("filterStatus") ?? undefined;

  if (wantHistory) {
    const history = await getBudgetHistory(user.id, 12);
    return NextResponse.json(history);
  }

  if (wantWizard && month) {
    const suggestions = await getBudgetPlanningSuggestions(month, user.id);
    return NextResponse.json(suggestions);
  }

  const budgets = await getBudgets(month, user.id, statusFilter);

  if (wantStatus && month) {
    const txns = await getTransactions({ userId: user.id });
    const monthTxns = txns.filter(
      (t) =>
        t.transactionType === "Expense" &&
        normalizeMonthKey(t.transactionDate) === month,
    );
    const byCat: Record<string, number> = {};
    let total = 0;
    for (const t of monthTxns) {
      byCat[t.category] = (byCat[t.category] ?? 0) + Number(t.amount);
      total += Number(t.amount);
    }

    // Previous month expenses for delta tracking
    const prevMonth = addMonths(month, -1);
    const prevMonthTxns = txns.filter(
      (t) =>
        t.transactionType === "Expense" &&
        normalizeMonthKey(t.transactionDate) === prevMonth,
    );
    const prevByCat: Record<string, number> = {};
    for (const t of prevMonthTxns) {
      prevByCat[t.category] =
        (prevByCat[t.category] ?? 0) + Number(t.amount);
    }

    const status = await computeBudgetStatus(
      month,
      byCat,
      total,
      undefined,
      user.id,
      new Date(),
      prevByCat,
    );

    // Enrich with LSTM Personalized forecast if available
    try {
      const forecast = await getPersonalizedForecast(user.id);
      if (forecast && forecast.targetMonth === month && forecast.predictedExpense !== null) {
        status.lstmForecast = {
          predictedExpense: forecast.predictedExpense,
          method: forecast.method,
          explanation: forecast.explanation,
          varianceVsBudget:
            status.overallBudget !== null
              ? Math.round((forecast.predictedExpense - status.overallBudget) * 100) / 100
              : null,
        };
      }
    } catch {
      // Graceful fallback if forecast pipeline is not initialized
    }

    return NextResponse.json({ budgets, status });
  }

  return NextResponse.json({ budgets });
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // Action: duplicate budgets from a previous month
    if (body.action === "duplicate") {
      const { fromMonth, toMonth } = body;
      if (!fromMonth || !toMonth) {
        return NextResponse.json(
          { error: "fromMonth and toMonth are required." },
          { status: 400 },
        );
      }
      const duplicated = await duplicateBudgets(fromMonth, toMonth, user.id);
      return NextResponse.json({ ok: true, budgets: duplicated }, { status: 201 });
    }

    // Action: bulk save (from Budget Planning Wizard)
    if (body.action === "bulk" && Array.isArray(body.budgets)) {
      const saved = [];
      for (const item of body.budgets as BudgetInput[]) {
        const b = await createBudget(item, user.id);
        saved.push(b);
      }
      return NextResponse.json({ ok: true, budgets: saved }, { status: 201 });
    }

    // Default single budget create / update
    const created = await createBudget(body as BudgetInput, user.id);
    return NextResponse.json({ ok: true, budget: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
