import { NextResponse } from "next/server";
import { db } from "@/db";
import { modelRuns } from "@/db/schema";
import { desc, eq, or, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const runs = await db
      .select()
      .from(modelRuns)
      .where(or(eq(modelRuns.userId, user.id), isNull(modelRuns.userId)))
      .orderBy(desc(modelRuns.trainingStart))
      .limit(20);

    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
