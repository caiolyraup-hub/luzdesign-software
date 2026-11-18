/* eslint-disable jsx-a11y/alt-text -- <Image> do @react-pdf não tem atributo alt */
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { COR_DESTAQUE, COR_DESTAQUE_SUAVE, COR_LINHA, COR_TEXTO } from "./tema";

Font.registerHyphenationCallback((palavra) => [palavra]);

/** Blocos do guia, lidos do Markdown (`# título`, `## seção`, `1. passo`, `- item`, parágrafo). */
export type BlocoGuia =
  | { tipo: "titulo"; texto: string }
  | { tipo: "secao"; texto: string }
  | { tipo: "passo"; numero: string; texto: string }
  | { tipo: "item"; texto: string }
  | { tipo: "paragrafo"; texto: string };

export function lerGuiaMarkdown(md: string): BlocoGuia[] {
  const blocos: BlocoGuia[] = [];
  for (const bruta of md.split(/\r?\n/)) {
    const l = bruta.trimEnd();
    if (!l.trim()) continue;
    let m: RegExpExecArray | null;
    if ((m = /^# (.+)/.exec(l))) blocos.push({ tipo: "titulo", texto: m[1] });
    else if ((m = /^## (.+)/.exec(l))) blocos.push({ tipo: "secao", texto: m[1] });
    else if ((m = /^(\d+)\. (.+)/.exec(l)))
      blocos.push({ tipo: "passo", numero: m[1], texto: m[2] });
    else if ((m = /^[-*] (.+)/.exec(l))) blocos.push({ tipo: "item", texto: m[1] });
    else blocos.push({ tipo: "paragrafo", texto: l.trim() });
  }
  return blocos;
}

/** Trechos com **negrito** e `código` para o <Text>. */
function Trechos({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <Text style={{ lineHeight: 1.32 }}>
      {partes.map((p, i) =>
        p.startsWith("**") ? (
          <Text key={i} style={{ fontFamily: "Helvetica-Bold" }}>
            {p.slice(2, -2)}
          </Text>
        ) : p.startsWith("`") ? (
          <Text key={i} style={{ fontFamily: "Courier" }}>
            {p.slice(1, -1)}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

export function DocumentoGuia({
  blocos,
  logo,
  tamanho = 9,
}: {
  blocos: BlocoGuia[];
  logo?: { data: Buffer; format: "png" | "jpg" } | null;
  tamanho?: number;
}) {
  const e = StyleSheet.create({
    pagina: {
      padding: 34,
      paddingBottom: 40,
      fontFamily: "Helvetica",
      fontSize: tamanho,
      color: COR_TEXTO,
    },
    cabecalho: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    titulo: { fontFamily: "Helvetica-Bold", fontSize: tamanho + 7, color: COR_DESTAQUE },
    filete: { height: 1.5, backgroundColor: COR_DESTAQUE, marginBottom: 8 },
    secao: {
      fontFamily: "Helvetica-Bold",
      fontSize: tamanho + 2,
      color: COR_DESTAQUE,
      marginTop: 8,
      marginBottom: 3,
      paddingBottom: 2,
      borderBottomWidth: 0.5,
      borderBottomColor: COR_LINHA,
    },
    linha: { flexDirection: "row", marginBottom: 2 },
    marcador: { width: 14, color: COR_DESTAQUE, fontFamily: "Helvetica-Bold" },
    corpo: { flex: 1 },
    paragrafo: { marginBottom: 3 },
    rodape: {
      position: "absolute",
      bottom: 22,
      left: 34,
      right: 34,
      flexDirection: "row",
      justifyContent: "space-between",
      fontSize: 8,
      color: "#6B7280",
    },
    destaque: { backgroundColor: COR_DESTAQUE_SUAVE, padding: 5, marginTop: 4, marginBottom: 2 },
  });
  return (
    <Document title="Guia rápido da vendedora - Luz Design" author="Luz Design">
      <Page size="A4" style={e.pagina} wrap>
        <View style={e.cabecalho}>
          <View style={{ flex: 1 }}>
            {blocos[0]?.tipo === "titulo" ? <Text style={e.titulo}>{blocos[0].texto}</Text> : null}
          </View>
          {logo ? (
            <Image src={logo} style={{ height: 30, objectFit: "contain" }} />
          ) : (
            <Text style={{ fontFamily: "Helvetica-Bold", letterSpacing: 3, color: COR_DESTAQUE }}>
              LUZ DESIGN
            </Text>
          )}
        </View>
        <View style={e.filete} />
        {blocos.slice(blocos[0]?.tipo === "titulo" ? 1 : 0).map((b, i) => {
          if (b.tipo === "secao")
            return (
              <Text key={i} style={e.secao} minPresenceAhead={40}>
                {b.texto}
              </Text>
            );
          if (b.tipo === "passo" || b.tipo === "item")
            return (
              <View key={i} style={e.linha} wrap={false}>
                <Text style={e.marcador}>{b.tipo === "passo" ? `${b.numero}.` : "•"}</Text>
                <View style={e.corpo}>
                  <Trechos texto={b.texto} />
                </View>
              </View>
            );
          const ehAviso = /^Se algo der errado|^Você não vê marca/.test(b.texto);
          return (
            <View key={i} style={ehAviso ? e.destaque : e.paragrafo} wrap={false}>
              <Trechos texto={b.texto} />
            </View>
          );
        })}
        <View style={e.rodape} fixed>
          <Text>Luz Design · Guia rápido da vendedora</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderizarGuia(
  blocos: BlocoGuia[],
  logo?: { data: Buffer; format: "png" | "jpg" } | null,
  tamanho = 9,
) {
  return renderToBuffer(<DocumentoGuia blocos={blocos} logo={logo} tamanho={tamanho} />);
}
