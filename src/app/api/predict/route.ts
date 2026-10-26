import { NextResponse } from "next/server";
import {
  getPersonalizedForecast,
  getMultiHorizonForecast,
  getCategoryForecasts,
  getGranularAnalysis,
  getPredictionExplainability,
  simulateSpendingScenario,
  getPredictionHistory,
  savePredictionRecord,
  type ForecastHorizon,
} from "@/ml/pipeline";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const horizon = searchParams.get("horizon") as ForecastHorizon | null;
    const type = searchParams.get("type");
    const categories = searchParams.get("categories");
    const granular = searchParams.get("granular");
    const explain = searchParams.get("explain");
    const history = searchParams.get("history");
    const full = searchParams.get("full");
    const targetMonth = searchParams.get("targetMonth") || undefined;

    if (full === "1" || full === "true") {
      const [
        personalized,
        multiHorizon,
        categorySummary,
        granularAnalysis,
        explainability,
        predHistory,
      ] = await Promise.all([
        getPersonalizedForecast(user.id),
        getMultiHorizonForecast(user.id, horizon ?? "30d"),
        getCategoryForecasts(user.id, targetMonth),
        getGranularAnalysis(user.id),
        getPredictionExplainability(user.id, targetMonth),
        getPredictionHistory(user.id),
      ]);

      return NextResponse.json({
        personalized,
        multiHorizon,
        categories: categorySummary,
        granular: granularAnalysis,
        explainability,
        history: predHistory,
      });
    }

    if (
      horizon &&
      (horizon === "7d" ||
        horizon === "30d" ||
        horizon === "3m" ||
        horizon === "6m")
    ) {
      const res = await getMultiHorizonForecast(user.id, horizon);
      return NextResponse.json(res);
    }

    if (categories === "1" || type === "categories") {
      const res = await getCategoryForecasts(user.id, targetMonth);
      return NextResponse.json(res);
    }

    if (granular === "1" || type === "granular") {
      const res = await getGranularAnalysis(user.id);
      return NextResponse.json(res);
    }

    if (explain === "1" || type === "explain") {
      const res = await getPredictionExplainability(user.id, targetMonth);
      return NextResponse.json(res);
    }

    if (history === "1" || type === "history") {
      const res = await getPredictionHistory(user.id);
      return NextResponse.json(res);
    }

    const forecast = await getPersonalizedForecast(user.id);
    return NextResponse.json(forecast);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const action = body.action || "simulate";

    if (action === "save") {
      await savePredictionRecord(
        user.id,
        body.targetMonth,
        body.amount,
        body.modelVersion,
      );
      return NextResponse.json({ ok: true, saved: true });
    }

    // Default POST action: simulate scenario
    const simulation = await simulateSpendingScenario(user.id, {
      categoryAdjustments: body.categoryAdjustments,
      oneOffExpenses: body.oneOffExpenses,
    });

    return NextResponse.json(simulation);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
