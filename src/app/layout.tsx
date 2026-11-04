import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { BarraNavegacao } from "@/components/BarraNavegacao";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luz Design Orçamentos",
  description: "Orçamentos com IA e acompanhamento de conversão da Luz Design.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full">
        <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">{children}</main>
        <Suspense>
          <BarraNavegacao />
        </Suspense>
      </body>
    </html>
  );
}
