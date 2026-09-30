import { ComingSoon } from "@/components/ComingSoon";

export const metadata = { title: "Covenant · Explore mandates" };

export default function ExplorePage() {
  return (
    <ComingSoon
      eyebrow="Public"
      title="Explore every mandate"
      description="A public directory of all Covenant mandates with their state and live compliance, so you can see this is a network, not a single demo."
      milestone="M6 (proof, trade panel, explore)"
    />
  );
}
