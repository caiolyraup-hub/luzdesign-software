/**
 * Troca de página: o conteúdo aparece com fade e um leve deslize (CSS; desligado com
 * prefers-reduced-motion). Fica DENTRO do layout para a barra de navegação não animar a cada página.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="pagina-entra">{children}</div>;
}
