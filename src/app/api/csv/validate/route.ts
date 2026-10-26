import { NextResponse } from "next/server";
import { parseCsv, validateCsv } from "@/lib/csvService";
import { findExistingExternalIds } from "@/lib/transactionService";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { text } = (await req.json()) as { text?: string };
    if (!text || !text.trim()) {
      return NextResponse.json(
        { ok: false, error: "No CSV text provided." },
        { status: 400 },
      );
    }
    const parsed = parseCsv(text);
    const externalIds = parsed
      .slice(1)
      .map((cols) => {
        const idx = parsed[0]
          .map((h) => h.trim().toLowerCase())
          .indexOf("external_transaction_id");
        return idx >= 0 ? (cols[idx] ?? "").trim() : "";
      })
      .filter(Boolean);
    const existing = await findExistingExternalIds(externalIds, user.id);
    const result = validateCsv(parsed, existing);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
