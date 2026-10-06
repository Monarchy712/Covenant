import { fetchProof } from "@/lib/api";

export const revalidate = 60;

/** Embeddable SVG badge: "Enforced by Covenant · N/N intervals paid". */
export async function GET(req: Request, ctx: { params: { id: string } }) {
  const vault = ctx.params.id;
  // ?theme=light|dark — default dark (unchanged for existing embeds).
  const theme = new URL(req.url).searchParams.get("theme") === "light" ? "light" : "dark";
  let paid = 0;
  let total = 0;
  let compliant = true;
  try {
    const proof = await fetchProof(vault, { next: { revalidate: 60 } });
    paid = proof.compliance.paidIntervals;
    total = proof.compliance.intervals.length;
    compliant = total === 0 || paid === total;
  } catch {
    /* render an "unknown" badge */
  }

  // Per-theme palette, matching the app's light/dark tokens. Semantics stay vivid
  // enough to read on either surface.
  const P =
    theme === "light"
      ? { bg: "#ffffff", stroke: "#e3e7ee", mark: "#0b0e14", label: "#586273", value: "#363f4d", accent: "#1a66e0", pass: "#0a7a42", fail: "#cf2230" }
      : { bg: "#0e1015", stroke: "#212630", mark: "#f3f5f8", label: "#8a93a2", value: "#c0c8d4", accent: "#4c8dff", pass: "#35c978", fail: "#f5565f" };
  const dot = total === 0 ? P.accent : compliant ? P.pass : P.fail;
  const right = total === 0 ? "live on Monad" : `${paid}/${total} intervals paid`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="44" viewBox="0 0 340 44" role="img" aria-label="Enforced by Covenant, ${right}">
  <rect x="0.5" y="0.5" width="339" height="43" rx="8" fill="${P.bg}" stroke="${P.stroke}"/>
  <g transform="translate(14,13)">
    <path d="M6 1H4.2A1.9 1.9 0 0 0 2.3 2.9v12.2A1.9 1.9 0 0 0 4.2 17H6M13 1h1.8A1.9 1.9 0 0 1 16.7 2.9v12.2A1.9 1.9 0 0 1 14.8 17H13" fill="none" stroke="${P.mark}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M9.5 4v10" stroke="${P.accent}" stroke-width="1.4" stroke-linecap="round"/>
  </g>
  <text x="42" y="20" font-family="ui-monospace,Menlo,monospace" font-size="12" fill="${P.label}" letter-spacing="0.4">ENFORCED BY</text>
  <text x="42" y="34" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="600" fill="${P.mark}">Covenant</text>
  <circle cx="150" cy="22" r="3" fill="${dot}"/>
  <text x="160" y="26" font-family="ui-monospace,Menlo,monospace" font-size="12.5" fill="${P.value}">${right}</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60",
    },
  });
}
