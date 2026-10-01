import { fetchProof } from "@/lib/api";

export const revalidate = 60;

/** Embeddable SVG badge: "Enforced by Covenant · N/N intervals paid". */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const vault = ctx.params.id;
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

  const accent = "#4c8dff";
  const pass = "#2fbf6b";
  const fail = "#f0454e";
  const dot = total === 0 ? accent : compliant ? pass : fail;
  const right = total === 0 ? "live on Monad" : `${paid}/${total} intervals paid`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="44" viewBox="0 0 340 44" role="img" aria-label="Enforced by Covenant, ${right}">
  <rect width="340" height="44" rx="8" fill="#0e1015" stroke="#212630"/>
  <g transform="translate(14,13)">
    <path d="M6 1H4.2A1.9 1.9 0 0 0 2.3 2.9v12.2A1.9 1.9 0 0 0 4.2 17H6M13 1h1.8A1.9 1.9 0 0 1 16.7 2.9v12.2A1.9 1.9 0 0 1 14.8 17H13" fill="none" stroke="#f3f5f8" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M9.5 4v10" stroke="${accent}" stroke-width="1.4" stroke-linecap="round"/>
  </g>
  <text x="42" y="20" font-family="ui-monospace,Menlo,monospace" font-size="12" fill="#838d9c" letter-spacing="0.4">ENFORCED BY</text>
  <text x="42" y="34" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="600" fill="#f3f5f8">Covenant</text>
  <circle cx="150" cy="22" r="3" fill="${dot}"/>
  <text x="160" y="26" font-family="ui-monospace,Menlo,monospace" font-size="12.5" fill="#c0c8d4">${right}</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=60",
    },
  });
}
