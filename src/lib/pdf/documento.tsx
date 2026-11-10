import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { moedaCentavos } from "../orcamento/totais";
import type { DadosPdf, ItemPdf } from "./dados";
import { COR_DESTAQUE, COR_DESTAQUE_SUAVE, COR_LINHA, COR_TEXTO, COR_TEXTO_SUAVE } from "./tema";

export interface LogoPdf {
  data: Buffer;
  format: "png" | "jpg";
}

const estilos = StyleSheet.create({
  pagina: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: COR_TEXTO,
  },
  // Cabeçalho
  cabecalho: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  marca: { maxWidth: 300 },
  logo: { height: 46, objectFit: "contain", objectPosition: "left" },
  nomeLoja: { fontFamily: "Times-Bold", fontSize: 24, letterSpacing: 4, color: COR_DESTAQUE },
  dadosLoja: { marginTop: 6, fontSize: 8.5, color: COR_TEXTO_SUAVE, lineHeight: 1.4 },
  numeroBloco: { alignItems: "flex-end" },
  rotuloOrcamento: { fontSize: 8.5, letterSpacing: 2, color: COR_TEXTO_SUAVE },
  numero: { fontFamily: "Helvetica-Bold", fontSize: 18, marginTop: 2 },
  datas: { marginTop: 6, fontSize: 9, textAlign: "right", lineHeight: 1.5 },
  filete: { height: 2, backgroundColor: COR_DESTAQUE, marginTop: 14, marginBottom: 14 },
  // Cliente
  cliente: {
    flexDirection: "row",
    backgroundColor: COR_DESTAQUE_SUAVE,
    padding: 10,
    borderRadius: 3,
    marginBottom: 14,
  },
  clienteCampo: { flex: 1, paddingRight: 8 },
  rotulo: { fontSize: 7.5, letterSpacing: 1, color: COR_TEXTO_SUAVE, textTransform: "uppercase" },
  valorCampo: { marginTop: 2, fontFamily: "Helvetica-Bold", fontSize: 10 },
  // Ambientes e tabela
  ambiente: { marginBottom: 9 },
  tituloAmbiente: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10.5,
    letterSpacing: 1,
    color: COR_DESTAQUE,
    textTransform: "uppercase",
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: COR_DESTAQUE,
  },
  cabecaTabela: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COR_LINHA,
    fontSize: 7.5,
    color: COR_TEXTO_SUAVE,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  linha: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COR_LINHA,
  },
  colQtd: { width: "11%" },
  colCodigo: { width: "11%" },
  colDescricao: { width: "47%", paddingRight: 8 },
  colUnit: { width: "15%", textAlign: "right" },
  colTotal: { width: "16%", textAlign: "right" },
  marcaItem: { fontSize: 8, color: COR_TEXTO_SUAVE, marginTop: 1 },
  subtotal: { flexDirection: "row", justifyContent: "flex-end", paddingTop: 5, fontSize: 9 },
  subtotalRotulo: { color: COR_TEXTO_SUAVE, marginRight: 8 },
  subtotalValor: { fontFamily: "Helvetica-Bold" },
  // Totais
  totais: { marginTop: 6, alignSelf: "flex-end", width: 260 },
  linhaTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    fontSize: 10,
  },
  avista: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COR_DESTAQUE,
    color: "#FFFFFF",
    padding: 8,
    borderRadius: 3,
    marginTop: 4,
  },
  avistaRotulo: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  avistaValor: { fontFamily: "Helvetica-Bold", fontSize: 15 },
  // Condições
  condicoes: { marginTop: 12, paddingTop: 7, borderTopWidth: 0.5, borderTopColor: COR_LINHA },
  tituloCondicoes: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    letterSpacing: 1,
    color: COR_DESTAQUE,
    marginBottom: 4,
  },
  condicao: { flexDirection: "row", fontSize: 8.5, lineHeight: 1.4 },
  marcador: { width: 10, color: COR_DESTAQUE },
  // Rodapé fixo
  rodape: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: COR_TEXTO_SUAVE,
    borderTopWidth: 0.5,
    borderTopColor: COR_LINHA,
    paddingTop: 6,
  },
});

function quantidadeTexto(item: ItemPdf): string {
  return `${String(item.quantidade).replace(".", ",")} ${item.unidade}`;
}

function Cabecalho({ dados, logo }: { dados: DadosPdf; logo: LogoPdf | null }) {
  const { loja } = dados;
  const linhasLoja = [
    loja.razao_social && loja.cnpj
      ? `${loja.razao_social} · CNPJ ${loja.cnpj}`
      : (loja.razao_social ?? (loja.cnpj ? `CNPJ ${loja.cnpj}` : null)),
    loja.endereco,
    [loja.telefone && `Tel. ${loja.telefone}`, loja.whatsapp && `WhatsApp ${loja.whatsapp}`]
      .filter(Boolean)
      .join(" · "),
    [loja.instagram, loja.site].filter(Boolean).join(" · "),
  ].filter((l): l is string => Boolean(l));

  return (
    <View style={estilos.cabecalho}>
      <View style={estilos.marca}>
        {logo ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- o Image do react-pdf não tem alt
          <Image src={logo} style={estilos.logo} />
        ) : (
          <Text style={estilos.nomeLoja}>{loja.nome_fantasia.toUpperCase()}</Text>
        )}
        <View style={estilos.dadosLoja}>
          {linhasLoja.map((l) => (
            <Text key={l}>{l}</Text>
          ))}
        </View>
      </View>
      <View style={estilos.numeroBloco}>
        <Text style={estilos.rotuloOrcamento}>ORÇAMENTO</Text>
        <Text style={estilos.numero}>Nº {dados.numero}</Text>
        <View style={estilos.datas}>
          <Text>Data: {dados.dataEmissao}</Text>
          <Text>Válido até {dados.validade}</Text>
          {dados.versao > 1 ? (
            <Text style={{ color: COR_TEXTO_SUAVE }}>Versão {dados.versao}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function DocumentoOrcamento({ dados, logo }: { dados: DadosPdf; logo: LogoPdf | null }) {
  const { cliente, totais } = dados;

  return (
    <Document
      title={`Orçamento ${dados.numero}`}
      author={dados.loja.nome_fantasia}
      subject={`Orçamento ${dados.numero} para ${cliente.nome}`}
    >
      <Page size="A4" style={estilos.pagina} wrap>
        <Cabecalho dados={dados} logo={logo} />
        <View style={estilos.filete} />

        <View style={estilos.cliente} wrap={false}>
          <View style={estilos.clienteCampo}>
            <Text style={estilos.rotulo}>Cliente</Text>
            <Text style={estilos.valorCampo}>{cliente.nome}</Text>
          </View>
          {cliente.whatsapp ? (
            <View style={estilos.clienteCampo}>
              <Text style={estilos.rotulo}>WhatsApp</Text>
              <Text style={estilos.valorCampo}>{cliente.whatsapp}</Text>
            </View>
          ) : null}
          {cliente.arquiteto ? (
            <View style={estilos.clienteCampo}>
              <Text style={estilos.rotulo}>Arquiteto(a)</Text>
              <Text style={estilos.valorCampo}>{cliente.arquiteto}</Text>
            </View>
          ) : null}
          <View style={estilos.clienteCampo}>
            <Text style={estilos.rotulo}>Vendedora</Text>
            <Text style={estilos.valorCampo}>{dados.vendedora}</Text>
          </View>
        </View>

        {dados.ambientes.map((ambiente) => (
          <View key={ambiente.nome} style={estilos.ambiente}>
            {/* Título + cabeçalho da tabela + 1ª linha nunca ficam sozinhos no pé da página. */}
            <View wrap={false} minPresenceAhead={70}>
              <Text style={estilos.tituloAmbiente}>{ambiente.nome}</Text>
              <View style={estilos.cabecaTabela}>
                <Text style={estilos.colQtd}>Qtd</Text>
                <Text style={estilos.colCodigo}>Código</Text>
                <Text style={estilos.colDescricao}>Descrição</Text>
                <Text style={estilos.colUnit}>Unit.</Text>
                <Text style={estilos.colTotal}>Total</Text>
              </View>
            </View>
            {ambiente.itens.map((item, i) => (
              <View key={`${ambiente.nome}-${i}`} style={estilos.linha} wrap={false}>
                <Text style={estilos.colQtd}>{quantidadeTexto(item)}</Text>
                <Text style={estilos.colCodigo}>{item.codigo ?? "—"}</Text>
                <View style={estilos.colDescricao}>
                  <Text>{item.descricao}</Text>
                  {item.marca ? <Text style={estilos.marcaItem}>{item.marca}</Text> : null}
                </View>
                <Text style={estilos.colUnit}>{moedaCentavos(item.precoCentavos)}</Text>
                <Text style={estilos.colTotal}>{moedaCentavos(item.totalCentavos)}</Text>
              </View>
            ))}
            <View style={estilos.subtotal} wrap={false}>
              <Text style={estilos.subtotalRotulo}>Subtotal {ambiente.nome}</Text>
              <Text style={estilos.subtotalValor}>{moedaCentavos(ambiente.subtotalCentavos)}</Text>
            </View>
          </View>
        ))}

        <View style={estilos.totais} wrap={false}>
          <View style={estilos.linhaTotal}>
            <Text>Total</Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>
              {moedaCentavos(totais.totalCentavos)}
            </Text>
          </View>
          {totais.percentual > 0 ? (
            <View style={estilos.linhaTotal}>
              <Text>Desconto à vista ({String(totais.percentual).replace(".", ",")}%)</Text>
              <Text>- {moedaCentavos(totais.descontoCentavos)}</Text>
            </View>
          ) : null}
          <View style={estilos.avista}>
            <Text style={estilos.avistaRotulo}>TOTAL À VISTA</Text>
            <Text style={estilos.avistaValor}>{moedaCentavos(totais.aVistaCentavos)}</Text>
          </View>
        </View>

        {dados.rodape.length > 0 ? (
          <View style={estilos.condicoes} wrap={false}>
            <Text style={estilos.tituloCondicoes}>CONDIÇÕES</Text>
            {dados.rodape.map((linha) => (
              <View key={linha} style={estilos.condicao}>
                <Text style={estilos.marcador}>•</Text>
                <Text>{linha}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={estilos.rodape} fixed>
          <Text>
            {dados.loja.nome_fantasia} · Orçamento {dados.numero}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
