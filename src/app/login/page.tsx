import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();

  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-8 text-slate-400">
          Loading login form...
        </div>
      }
    >
      <LoginForm currentUser={user} />
    </Suspense>
  );
}
