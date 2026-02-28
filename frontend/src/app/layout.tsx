import type { Metadata } from "next";
import { Inter, Syne } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "700", "800"], // Explicitly loading bold weights for the headings
});

export const metadata: Metadata = {
  title: "VisiRoom | Visual Commerce AI",
  description: "Upload a photo of your product, then your room, and let AI blend them together seamlessly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script src="https://js.puter.com/v2/"></script>
      </head>
      <body
        className={`${inter.variable} ${syne.variable} font-sans antialiased bg-[var(--background)] text-[var(--foreground)] selection:bg-[var(--accent)] selection:text-[var(--foreground)]`}
      >
        {children}
      </body>
    </html>
  );
}