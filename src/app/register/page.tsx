import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import RegisterForm from "./RegisterForm";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await getSessionUser();

  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-8 text-slate-400">
          Loading registration form...
        </div>
      }
    >
      <RegisterForm currentUser={user} />
    </Suspense>
  );
}
