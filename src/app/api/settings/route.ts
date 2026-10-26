import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settingsService";
import { getSessionUser } from "@/lib/auth";
import type { AppSettings } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getSettings(user.id);
  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Partial<AppSettings>;
    const merged = await saveSettings(body, user.id);
    return NextResponse.json({ ok: true, settings: merged });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
