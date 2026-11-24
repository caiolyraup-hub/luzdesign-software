/** Troca de página: aparece com fade e um leve deslize (CSS; desligado com prefers-reduced-motion). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="pagina-entra">{children}</div>;
}
