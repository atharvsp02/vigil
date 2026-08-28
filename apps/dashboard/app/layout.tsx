import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vigil",
  description: "An on-call agent that investigates, proves, and asks before it acts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
