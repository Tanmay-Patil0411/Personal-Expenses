import { NextResponse } from "next/server";
import { resetPasswordWithToken, verifyPasswordResetToken } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token") || "";

    const check = await verifyPasswordResetToken(token);
    if (!check.valid) {
      return NextResponse.json({ valid: false, error: check.error }, { status: 400 });
    }

    return NextResponse.json({ valid: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token validation failed.";
    return NextResponse.json({ valid: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, newPassword } = body;

    if (!token || !newPassword) {
      return NextResponse.json(
        { error: "Token and new password are required." },
        { status: 400 },
      );
    }

    const result = await resetPasswordWithToken(token, newPassword);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message: "Password has been successfully updated. You can now log in.",
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Password reset failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
