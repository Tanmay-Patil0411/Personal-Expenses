import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession, getSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const token = await getSessionToken(request);
    if (token) {
      await destroySession(token);
    }

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Logout failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
