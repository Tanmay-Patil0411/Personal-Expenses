import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import PredictionClient from "./PredictionClient";

export const dynamic = "force-dynamic";

export default async function PredictionPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <PredictionClient user={user} />;
}
