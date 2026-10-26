import { NextResponse } from "next/server";
import { buildCsvTemplate } from "@/lib/csvService";

export const dynamic = "force-dynamic";

export async function GET() {
  const csv = buildCsvTemplate();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="expense_template.csv"',
    },
  });
}
