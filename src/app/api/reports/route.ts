import { NextResponse } from "next/server";
import { buildReport } from "@/lib/reportService";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const sp = url.searchParams;
    const mode = (sp.get("mode") as "monthly" | "yearly") ?? "monthly";
    const month = sp.get("month") ?? undefined;
    const year = sp.get("year") ?? undefined;
    const category = sp.get("category") ?? undefined;
    const paymentMethod = sp.get("paymentMethod") ?? undefined;

    const report = await buildReport(
      { mode, month, year, category, paymentMethod },
      user.id,
      { name: user.name, email: user.email },
    );
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
