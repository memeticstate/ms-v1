import type { Metadata } from "next";
import { MemeticAuthProvider } from "@/components/memetic-auth-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Memetic State — The present, with context",
  description:
    "Independent attention intelligence for PONS launches and tokenized-stock habitats on Robinhood Chain.",
  icons: {
    icon: "/favicon-compass.svg?v=20260909",
    shortcut: "/favicon-compass.svg?v=20260909",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <MemeticAuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </MemeticAuthProvider>
      </body>
    </html>
  );
}
