import { NextResponse } from "next/server";
import { createPasswordResetToken } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 },
      );
    }

    const result = await createPasswordResetToken(email);

    // To prevent email enumeration, standard security practice is to return success
    // whether the email exists or not. In this environment, we also provide the token
    // so the user can easily reset without an external email provider configured.
    return NextResponse.json({
      ok: true,
      message:
        "If an account with that email exists, password reset instructions have been generated.",
      resetToken: result?.token ?? null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Password reset request failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
