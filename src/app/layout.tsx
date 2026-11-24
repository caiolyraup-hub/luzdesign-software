import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

// Títulos em Montserrat. O Next guarda a fonte junto com o site (nenhuma chamada ao Google no navegador).
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-montserrat",
});

export const metadata: Metadata = {
  title: "Luz Design Orçamentos",
  description: "Orçamentos com IA e acompanhamento de conversão da Luz Design.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fffdf8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
