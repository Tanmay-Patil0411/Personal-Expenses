import { NextResponse } from "next/server";
import { runTrainingPipeline } from "@/ml/pipeline";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
// Allow a longer timeout for model training.
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const datasetMode = typeof body?.datasetMode === "string" ? body.datasetMode : undefined;

    const outcome = await runTrainingPipeline(user.id, { datasetMode });
    return NextResponse.json(outcome, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
