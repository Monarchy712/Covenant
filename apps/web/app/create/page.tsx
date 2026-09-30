import { ComingSoon } from "@/components/ComingSoon";

export const metadata = { title: "Covenant · Create a mandate" };

export default function CreatePage() {
  return (
    <ComingSoon
      eyebrow="Issuer"
      title="Create a mandate"
      description="A guided wizard: pick your token and market, set terms in plain language with a live preview, invite a market maker, then fund and launch on-chain."
      milestone="M3 (create wizard)"
    />
  );
}
