import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Covenant · a market-making mandate the MM can't break",
  description:
    "Hire a market maker who physically cannot dump your tokens. Inventory lives in a contract that owns every Kuru order and only pays for KPI-proven liquidity. On Monad.",
  metadataBase: new URL("https://covenant.markets"),
  openGraph: {
    title: "Covenant · a market-making mandate the MM can't break",
    description:
      "Inventory the MM can use but not take. Fees paid only when the chain proves the work. On Monad's on-chain order book.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#08090c" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
  ],
  colorScheme: "dark light",
};

// Applies a stored light/dark choice to <html> BEFORE first paint, so there is no
// flash of the wrong theme. No stored choice => attribute stays unset and the CSS
// `prefers-color-scheme` rules decide. Kept tiny and dependency-free.
const NO_FLASH = `(function(){try{var t=localStorage.getItem('covenant-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
