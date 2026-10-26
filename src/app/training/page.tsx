import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import TrainingClient from "./TrainingClient";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <TrainingClient user={user} />;
}
