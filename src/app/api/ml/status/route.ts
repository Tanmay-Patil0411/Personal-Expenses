import { NextResponse } from "next/server";
import { getForecastStatus } from "@/ml/pipeline";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getForecastStatus(user.id);
  return NextResponse.json(status);
}
