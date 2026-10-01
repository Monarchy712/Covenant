import { redirect } from "next/navigation";
import { fetchConfig } from "@/lib/api";

export const revalidate = 60;
export const metadata = { title: "Covenant · Verify a mandate" };

/** The /proof hub points at the live flagship proof; /explore lists them all. */
export default async function ProofHub() {
  let target = "/explore";
  try {
    const config = await fetchConfig({ next: { revalidate: 60 } });
    target = `/proof/${config.flagship.vault}`;
  } catch {
    /* fall back to the directory */
  }
  redirect(target);
}
