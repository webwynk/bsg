import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Best Smart Game Dashboard",
  description: "Administrative Back Office & God Mode Control Portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Dark mode only (2026-11-07, Hasan's decision): `dark` is on <html> from the
  // first paint (no light flash, even before any script runs), next-themes is
  // forced to dark (a saved 'light' choice or a light device setting is
  // ignored), and color-scheme: dark (globals.css) makes the browser's own
  // parts -- scrollbars, autofill, native inputs -- dark too. There is no theme
  // toggle any more. PDFs are drawn by jsPDF with their own colours and are not
  // affected.
  return (
    <html
      lang="en"
      className={`${dmSans.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
