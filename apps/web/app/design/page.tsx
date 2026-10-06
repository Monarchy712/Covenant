import type { Metadata } from "next";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Badge, StateBadge } from "@/components/ui/Badge";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Stat } from "@/components/ui/Stat";
import { AllowanceGauge } from "@/components/AllowanceGauge";
import { KpiTimeline, type IntervalCell } from "@/components/KpiTimeline";
import { OrderBookMini } from "@/components/OrderBookMini";

export const metadata: Metadata = { title: "Covenant · Design system" };

const NEUTRALS = [
  ["canvas", "#08090c"],
  ["canvas-raised", "#0b0d11"],
  ["surface-1", "#0e1015"],
  ["surface-2", "#14171d"],
  ["surface-3", "#1a1e25"],
  ["hairline", "#212630"],
  ["hairline-strong", "#2e3542"],
];
const INKS = [
  ["ink", "#f3f5f8"],
  ["ink-muted", "#c0c8d4"],
  ["ink-subtle", "#838d9c"],
  ["ink-faint", "#565f6d"],
];
const SEMANTIC = [
  ["accent", "#4c8dff", "brand · interactive · focus"],
  ["pass", "#2fbf6b", "compliant · paid · passing"],
  ["fail", "#f0454e", "blocked · failed"],
  ["warn", "#f5a524", "paused · warning"],
  ["idle", "#6b7482", "unobserved · neutral"],
];

const TYPE = [
  ["Display", "text-[58px] font-semibold tracking-[-0.02em] leading-[1.05]", "Enforced by contract"],
  ["Heading", "text-[33px] font-semibold tracking-[-0.01em]", "Hire a market maker"],
  ["Title", "text-[17px] font-medium", "Mandate dashboard"],
  ["Body", "text-[16px] text-ink-muted leading-relaxed", "The vault owns every order on the book."],
  ["Caption", "text-[13px] uppercase tracking-[0.12em] text-ink-subtle", "Net sold this window"],
  ["Numeric (mono, tabular)", "num text-[26px] text-ink", "1,240.50 / 1,000"],
];

export default function DesignPage() {
  const cells: IntervalCell[] = [
    ...Array.from({ length: 12 }, (_, i) => ({ interval: i, status: "paid" as const })),
    { interval: 12, status: "failed" as const },
    { interval: 13, status: "paused" as const },
    { interval: 14, status: "paused" as const },
    ...Array.from({ length: 6 }, (_, i) => ({ interval: 15 + i, status: "paid" as const })),
    { interval: 21, status: "unobserved" as const },
    { interval: 22, status: "unobserved" as const },
  ];

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-5">
          <Wordmark />
          <span className="text-[13px] uppercase tracking-[0.14em] text-ink-faint">
            Design system
          </span>
        </div>
      </header>

      <main id="main" className="mx-auto flex max-w-[1100px] flex-col gap-16 px-6 py-14">
        <div>
          <h1 className="text-[37px] font-semibold tracking-[-0.02em] text-ink">
            Institutional trust, terminal precision
          </h1>
          <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-ink-muted">
            One locked dark theme. One accent. Semantic colors carry meaning only. Every number is
            tabular. Grounded in Linear (hairline panels, accent for meaning) and Stripe (tabular
            figures where money matters).
          </p>
        </div>

        {/* Color */}
        <Section title="Color">
          <SubLabel>Neutral base</SubLabel>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {NEUTRALS.map(([name, hex]) => (
              <Swatch key={name} name={name} hex={hex} />
            ))}
          </div>
          <SubLabel className="mt-6">Ink</SubLabel>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {INKS.map(([name, hex]) => (
              <Swatch key={name} name={name} hex={hex} border />
            ))}
          </div>
          <SubLabel className="mt-6">Accent &amp; semantic (meaning only)</SubLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {SEMANTIC.map(([name, hex, use]) => (
              <div key={name} className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-1 p-3">
                <div className="h-10 w-full rounded-sm" style={{ background: hex }} />
                <div>
                  <div className="text-[14px] font-medium text-ink">{name}</div>
                  <div className="num text-[12px] text-ink-faint">{hex}</div>
                  <div className="mt-0.5 text-[12px] text-ink-subtle">{use}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Type */}
        <Section title="Typography">
          <p className="mb-4 max-w-[60ch] text-[14px] text-ink-subtle">
            Geist Sans for interface and display, Geist Mono for every number (tabular figures).
          </p>
          <div className="flex flex-col divide-y divide-hairline overflow-hidden rounded-md border border-hairline">
            {TYPE.map(([label, cls, sample]) => (
              <div key={label} className="flex flex-col gap-2 bg-surface-1 p-5 sm:flex-row sm:items-baseline sm:gap-8">
                <span className="w-48 shrink-0 text-[13px] uppercase tracking-[0.12em] text-ink-faint">
                  {label}
                </span>
                <span className={cls}>{sample}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Radii + spacing */}
        <Section title="Radius &amp; spacing">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <SubLabel>Radius · controls 6 · panels 10 · chips pill</SubLabel>
              <div className="flex items-end gap-4">
                {[
                  ["sm", "rounded-sm", "6px"],
                  ["md", "rounded-md", "10px"],
                  ["lg", "rounded-lg", "14px"],
                  ["pill", "rounded-pill", "999"],
                ].map(([n, cls, px]) => (
                  <div key={n} className="flex flex-col items-center gap-2">
                    <div className={`size-14 border border-hairline-strong bg-surface-2 ${cls}`} />
                    <span className="text-[12px] text-ink-subtle">{n}</span>
                    <span className="num text-[11px] text-ink-faint">{px}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <SubLabel>Spacing · 4px base</SubLabel>
              <div className="flex items-end gap-3">
                {[4, 8, 12, 16, 24, 32, 48].map((s) => (
                  <div key={s} className="flex flex-col items-center gap-2">
                    <div className="bg-accent/70" style={{ width: s, height: s }} />
                    <span className="num text-[11px] text-ink-faint">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Components */}
        <Section title="Components">
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Buttons" hint="active state nudges down 1px" />
              <div className="flex flex-wrap items-center gap-3 p-4">
                <Button variant="primary">Launch mandate</Button>
                <Button variant="secondary">Cancel</Button>
                <Button variant="ghost">Skip</Button>
                <Button variant="danger">Terminate</Button>
                <Button variant="primary" disabled>
                  Disabled
                </Button>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Status" hint="state badges + semantic chips" />
              <div className="flex flex-wrap items-center gap-2 p-4">
                {["CREATED", "ACCEPTED", "ACTIVE", "PAUSED", "ENDED", "SETTLED"].map((s) => (
                  <StateBadge key={s} state={s} />
                ))}
                <Badge tone="pass" dot>
                  Compliant
                </Badge>
                <Badge tone="fail" dot>
                  Blocked
                </Badge>
                <Badge tone="accent">Enforced by contract</Badge>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Stats" hint="tabular numerals, semantic tone" />
              <div className="grid grid-cols-3 gap-4 p-4">
                <Stat label="Intervals paid" value="90" tone="pass" />
                <Stat label="Fees accrued" value="4,500" unit="USDC" tone="accent" />
                <Stat label="Consec. fails" value="0" tone="idle" />
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Allowance gauge" hint="net sold / cap this window" />
              <div className="flex flex-col gap-4 p-4">
                <AllowanceGauge netSold={320} cap={1000} />
                <AllowanceGauge netSold={790} cap={1000} />
                <AllowanceGauge netSold={960} cap={1000} />
              </div>
            </Panel>

            <Panel className="lg:col-span-1">
              <PanelHeader title="KPI timeline" hint="green paid · red failed · grey unobserved · striped paused" />
              <div className="p-4">
                <KpiTimeline cells={cells} />
              </div>
            </Panel>

            <Panel className="lg:col-span-1">
              <PanelHeader title="Order book" hint="vault orders marked · band shaded" />
              <OrderBookMini
                className="py-2"
                mid={2.021}
                bandBps={200}
                asks={[
                  { price: 2.061, size: 120 },
                  { price: 2.044, size: 90, isVault: true },
                  { price: 2.03, size: 60, isVault: true },
                ]}
                bids={[
                  { price: 2.008, size: 80, isVault: true },
                  { price: 1.995, size: 70, isVault: true },
                  { price: 1.972, size: 110 },
                ]}
              />
            </Panel>
          </div>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-5 text-[14px] font-medium uppercase tracking-[0.16em] text-ink-subtle">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-3 text-[13px] text-ink-faint ${className ?? ""}`}>{children}</div>
  );
}

function Swatch({ name, hex, border }: { name: string; hex: string; border?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`h-14 w-full rounded-md ${border ? "border border-hairline" : ""}`}
        style={{ background: hex }}
      />
      <div className="text-[13px] font-medium text-ink">{name}</div>
      <div className="num text-[12px] text-ink-faint">{hex}</div>
    </div>
  );
}
