import { redirect } from "next/navigation";
import { Landing } from "@/components/landing";
import { getOptionalUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getOptionalUser();
  if (user) redirect("/inicio");
  return <Landing />;
}
