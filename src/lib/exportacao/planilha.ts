import type { Writable } from "node:stream";
import ExcelJS from "exceljs";
import { COR_DESTAQUE } from "../pdf/tema";
import { rotuloMotivo, rotuloStatus } from "../orcamento/status";
import { hojeMaceioISO } from "../formatar";
import { OPCOES_TIPO_CLIENTE } from "../orcamento/perguntas";
import { estaVencido } from "../orcamento/validade";

/**
 * Exportação da base em planilha (cláusula 7.3 do contrato: o dado é da loja e precisa sair).
 *
 * Escreve em modo de fluxo (`exceljs` WorkbookWriter): as linhas vão para o arquivo conforme chegam,
 * então milhares de orçamentos e dezenas de milhares de itens não estouram a memória. Os orçamentos
 * ficam na memória como linhas compactas (alguns milhares de linhas são poucos MB); os itens e os
 * eventos são lidos em lotes, enquanto cada aba é escrita.
 */

export interface OrcamentoExport {
  id: string;
  numero: string;
  vendedora_id: string;
  vendedora_nome: string | null;
  cliente_id: string;
  cliente_nome: string | null;
  cliente_whatsapp: string | null;
  cliente_tipo: string | null;
  arquiteto_indicador: string | null;
  endereco?: string | null;
  arquiteto_id?: string | null;
  status: string;
  valor_total: number;
  valor_fechado: number | null;
  motivo_perda: string | null;
  criado_em: string;
  gerado_em: string | null;
  enviado_em: string | null;
  ultimo_envio_em: string | null;
  fechado_em: string | null;
  perdido_em: string | null;
  validade: string | null;
  pdf_versao: number;
}

export interface ItemExport {
  orcamento_id: string;
  ambiente: string | null;
  codigo: string | null;
  descricao: string;
  quantidade: number;
  unidade: string;
  preco_unitario: number;
  avulso: boolean;
  origem: string | null;
  /** Só a gerência recebe (a RLS não devolve nada à vendedora). */
  fabricante?: string | null;
  referencia_fabricante?: string | null;
}

export interface EventoExport {
  orcamento_id: string;
  de_status: string | null;
  para_status: string;
  criado_em: string;
  quem: string | null;
}

export interface ArquitetoExport {
  id: string;
  nome: string;
  escritorio: string | null;
  whatsapp: string | null;
  email: string | null;
  aniversario_dia: number | null;
  aniversario_mes: number | null;
  ativo: boolean;
}

export interface FonteExportacao {
  /** Todos os orçamentos do filtro (já limitados pela RLS de quem exporta). */
  orcamentos: OrcamentoExport[];
  /** Itens de um lote de orçamentos. */
  itens: (ids: string[]) => Promise<ItemExport[]>;
  /** Eventos de status de um lote de orçamentos (só a gerência usa). */
  eventos?: (ids: string[]) => Promise<EventoExport[]>;
  /** Cadastro de arquitetos, sem foto (só a gerência usa). */
  arquitetos?: () => Promise<ArquitetoExport[]>;
}

export interface MetaExportacao {
  exportadoPor: string;
  exportadoEm: Date;
  /** Filtros usados, em texto ("Em andamento", "Busca: silva"...). */
  filtros: string[];
  incluiuTeste: boolean;
  /** Aba Eventos e tabela por vendedora no Resumo: só a gerência. */
  gerencia: boolean;
  /** Chamado com as contagens antes de fechar o arquivo (para a auditoria). */
  aoFinalizar?: (linhas: ContagemExportacao) => Promise<void> | void;
}

export interface ContagemExportacao {
  orcamentos: number;
  itens: number;
  clientes: number;
  eventos: number;
  arquitetos: number;
}

export const TAMANHO_LOTE = 100;
const FORMATO_REAIS = '"R$" #,##0.00';
const FORMATO_DATA_HORA = "dd/mm/yyyy hh:mm";
const FORMATO_DATA = "dd/mm/yyyy";
const COR_CABECALHO = `FF${COR_DESTAQUE.replace("#", "").toUpperCase()}`;

const ROTULOS_ORIGEM: Record<string, string> = {
  manual: "Manual",
  lista_colada: "Lista colada",
  indicacao_ia: "Indicação da IA",
  montagem_ia: "Montagem antiga",
};
const rotuloTipo = (t: string | null) =>
  OPCOES_TIPO_CLIENTE.find((o) => o.valor === t)?.rotulo ?? t ?? "";
const simNao = (b: boolean) => (b ? "Sim" : "Não");

const partesMaceio = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Maceio",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Instante -> data do Excel no horário de Maceió. O Excel não guarda fuso: gravamos a hora de parede
 * de Maceió como se fosse UTC, e o formato mostra exatamente o que a vendedora viu no sistema.
 */
export function dataExcelMaceio(instante: string | Date | null | undefined): Date | null {
  if (!instante) return null;
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(partesMaceio.formatToParts(d).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

/** AAAA-MM-DD -> data do Excel (meia-noite, sem fuso). */
export function dataSimplesExcel(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return a ? new Date(Date.UTC(a, m - 1, d)) : null;
}

const arred = (n: number) => Math.round(n * 100) / 100;

interface ColunaSpec {
  chave: string;
  titulo: string;
  largura: number;
  formato?: string;
}

function novaAba(
  wb: ExcelJS.stream.xlsx.WorkbookWriter,
  nome: string,
  colunas: ColunaSpec[],
  opcoes: { filtro?: boolean } = {},
) {
  const ws = wb.addWorksheet(nome, {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = colunas.map((c) => ({
    key: c.chave,
    width: c.largura,
    style: c.formato ? { numFmt: c.formato } : undefined,
  }));
  const cab = ws.addRow(colunas.map((c) => c.titulo));
  cab.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_CABECALHO } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  cab.commit();
  if (opcoes.filtro !== false) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: colunas.length },
    };
  }
  return ws;
}

/** Adiciona uma linha com os formatos de cada coluna (datas e valores como número, WhatsApp como texto). */
function linha(ws: ExcelJS.Worksheet, colunas: ColunaSpec[], valores: unknown[]) {
  const r = ws.addRow(valores);
  colunas.forEach((c, i) => {
    if (c.formato) r.getCell(i + 1).numFmt = c.formato;
  });
  r.commit();
}

const COL_ORCAMENTOS: ColunaSpec[] = [
  { chave: "numero", titulo: "Número", largura: 12 },
  { chave: "vendedora", titulo: "Vendedora", largura: 16 },
  { chave: "cliente", titulo: "Cliente", largura: 30 },
  { chave: "whatsapp", titulo: "WhatsApp", largura: 18, formato: "@" },
  { chave: "tipo", titulo: "Tipo de cliente", largura: 16 },
  { chave: "arquiteto", titulo: "Arquiteto", largura: 22 },
  { chave: "endereco", titulo: "Endereço da obra", largura: 36 },
  { chave: "status", titulo: "Status", largura: 16 },
  { chave: "valor", titulo: "Valor total", largura: 15, formato: FORMATO_REAIS },
  { chave: "fechado", titulo: "Valor fechado", largura: 15, formato: FORMATO_REAIS },
  { chave: "motivo", titulo: "Motivo da perda", largura: 24 },
  { chave: "criado", titulo: "Criado", largura: 17, formato: FORMATO_DATA_HORA },
  { chave: "gerado", titulo: "Gerado", largura: 17, formato: FORMATO_DATA_HORA },
  { chave: "enviado", titulo: "Enviado (primeiro)", largura: 17, formato: FORMATO_DATA_HORA },
  { chave: "ultimo", titulo: "Último envio", largura: 17, formato: FORMATO_DATA_HORA },
  { chave: "fechado_em", titulo: "Fechado", largura: 17, formato: FORMATO_DATA_HORA },
  { chave: "perdido_em", titulo: "Perdido", largura: 17, formato: FORMATO_DATA_HORA },
  { chave: "validade", titulo: "Validade", largura: 13, formato: FORMATO_DATA },
  { chave: "vencido", titulo: "Vencido", largura: 10 },
  { chave: "versao", titulo: "Versão do PDF", largura: 10 },
];

const COL_ITENS: ColunaSpec[] = [
  { chave: "numero", titulo: "Orçamento", largura: 12 },
  { chave: "ambiente", titulo: "Ambiente", largura: 18 },
  { chave: "codigo", titulo: "Código", largura: 10, formato: "@" },
  { chave: "descricao", titulo: "Descrição", largura: 50 },
  { chave: "quantidade", titulo: "Quantidade", largura: 12, formato: "#,##0.00" },
  { chave: "unidade", titulo: "Unidade", largura: 9 },
  { chave: "preco", titulo: "Preço unitário", largura: 15, formato: FORMATO_REAIS },
  { chave: "total", titulo: "Total do item", largura: 15, formato: FORMATO_REAIS },
  { chave: "avulso", titulo: "Avulso", largura: 9 },
  { chave: "origem", titulo: "Origem", largura: 17 },
];

/** Colunas extras da aba Itens, só para a gerência (fabricante e referência nunca saem para a vendedora). */
const COL_ITENS_GERENCIA: ColunaSpec[] = [
  { chave: "fabricante", titulo: "Fabricante", largura: 16 },
  { chave: "referencia", titulo: "Referência do fabricante", largura: 24, formato: "@" },
];

const COL_CLIENTES: ColunaSpec[] = [
  { chave: "cliente", titulo: "Cliente", largura: 30 },
  { chave: "whatsapp", titulo: "WhatsApp", largura: 18, formato: "@" },
  { chave: "tipo", titulo: "Tipo", largura: 16 },
  { chave: "arquiteto", titulo: "Arquiteto", largura: 22 },
  { chave: "endereco", titulo: "Último endereço informado", largura: 36 },
  { chave: "orcamentos", titulo: "Orçamentos", largura: 12, formato: "0" },
  { chave: "enviados", titulo: "Enviados", largura: 10, formato: "0" },
  { chave: "fechados", titulo: "Fechados", largura: 10, formato: "0" },
  { chave: "vendido", titulo: "Valor vendido", largura: 15, formato: FORMATO_REAIS },
  { chave: "ultimo", titulo: "Último orçamento", largura: 17, formato: FORMATO_DATA_HORA },
];

const COL_ARQUITETOS: ColunaSpec[] = [
  { chave: "nome", titulo: "Arquiteto", largura: 28 },
  { chave: "escritorio", titulo: "Escritório", largura: 26 },
  { chave: "whatsapp", titulo: "WhatsApp", largura: 18, formato: "@" },
  { chave: "email", titulo: "E-mail", largura: 28 },
  { chave: "aniversario", titulo: "Aniversário", largura: 13, formato: "@" },
  { chave: "ativo", titulo: "Ativo", largura: 8 },
  { chave: "indicados", titulo: "Orçamentos indicados", largura: 14, formato: "0" },
  { chave: "fechados", titulo: "Fechados", largura: 10, formato: "0" },
  { chave: "vendido", titulo: "Valor vendido", largura: 15, formato: FORMATO_REAIS },
  { chave: "ultimo", titulo: "Último orçamento", largura: 17, formato: FORMATO_DATA_HORA },
];

const COL_EVENTOS: ColunaSpec[] = [
  { chave: "numero", titulo: "Orçamento", largura: 12 },
  { chave: "vendedora", titulo: "Vendedora", largura: 16 },
  { chave: "de", titulo: "De", largura: 16 },
  { chave: "para", titulo: "Para", largura: 16 },
  { chave: "quando", titulo: "Data", largura: 17, formato: FORMATO_DATA_HORA },
  { chave: "quem", titulo: "Quem mudou", largura: 18 },
];

const EM_ABERTO = ["enviado", "followup_d5", "followup_d10"];

interface Soma {
  qtd: number;
  valor: number;
  enviados: number;
  fechados: number;
  vendido: number;
  perdidos: number;
  perdido: number;
  abertoQtd: number;
  aberto: number;
}
const somaVazia = (): Soma => ({
  qtd: 0,
  valor: 0,
  enviados: 0,
  fechados: 0,
  vendido: 0,
  perdidos: 0,
  perdido: 0,
  abertoQtd: 0,
  aberto: 0,
});
function somar(s: Soma, o: OrcamentoExport) {
  s.qtd++;
  s.valor += o.valor_total;
  if (o.enviado_em) s.enviados++;
  if (o.status === "fechado") {
    s.fechados++;
    s.vendido += o.valor_fechado ?? o.valor_total;
  }
  if (o.status === "perdido") {
    s.perdidos++;
    s.perdido += o.valor_total;
  }
  if (EM_ABERTO.includes(o.status)) {
    s.abertoQtd++;
    s.aberto += o.valor_total;
  }
}

/** Escreve a planilha de exportação em `saida` e devolve as contagens de linhas. */
export async function escreverExportacao(
  fonte: FonteExportacao,
  saida: Writable,
  meta: MetaExportacao,
): Promise<ContagemExportacao> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: saida,
    useStyles: true,
    useSharedStrings: false,
  });
  wb.creator = "Luz Design Orçamentos";
  wb.created = meta.exportadoEm;

  const hoje = hojeMaceioISO(meta.exportadoEm);
  const orcs = fonte.orcamentos;
  const total = somaVazia();
  const porVendedora = new Map<string, { nome: string; soma: Soma }>();
  const porCliente = new Map<
    string,
    {
      nome: string;
      whatsapp: string | null;
      tipo: string | null;
      arquiteto: string | null;
      endereco: string | null;
      orcamentos: number;
      enviados: number;
      fechados: number;
      vendido: number;
      ultimo: string;
    }
  >();
  for (const o of orcs) {
    somar(total, o);
    const v = porVendedora.get(o.vendedora_id) ?? {
      nome: o.vendedora_nome ?? "—",
      soma: somaVazia(),
    };
    somar(v.soma, o);
    porVendedora.set(o.vendedora_id, v);
    const c = porCliente.get(o.cliente_id) ?? {
      nome: o.cliente_nome ?? "Sem cliente",
      whatsapp: o.cliente_whatsapp,
      tipo: o.cliente_tipo,
      arquiteto: o.arquiteto_indicador,
      endereco: o.endereco ?? null,
      orcamentos: 0,
      enviados: 0,
      fechados: 0,
      vendido: 0,
      ultimo: o.criado_em,
    };
    c.orcamentos++;
    if (o.enviado_em) c.enviados++;
    if (o.status === "fechado") {
      c.fechados++;
      c.vendido += o.valor_fechado ?? o.valor_total;
    }
    if (o.criado_em > c.ultimo) {
      c.ultimo = o.criado_em;
      if (o.endereco) c.endereco = o.endereco;
    }
    porCliente.set(o.cliente_id, c);
  }

  // ---------------------------------------------------------------- Resumo
  {
    const ws = wb.addWorksheet("Resumo", { properties: { defaultRowHeight: 18 } });
    ws.columns = [
      { key: "a", width: 34 },
      { key: "b", width: 18 },
      { key: "c", width: 18 },
      { key: "d", width: 12 },
      { key: "e", width: 12 },
      { key: "f", width: 18 },
      { key: "g", width: 12 },
      { key: "h", width: 18 },
      { key: "i", width: 14 },
      { key: "j", width: 18 },
    ];
    const rotulo = (r: ExcelJS.Row) => {
      r.getCell(1).font = { bold: true };
    };
    const kv = (k: string, v: unknown, fmt?: string) => {
      const r = ws.addRow([k, v]);
      rotulo(r);
      if (fmt) r.getCell(2).numFmt = fmt;
      r.getCell(2).alignment = { horizontal: "left" };
      r.commit();
    };
    const titulo = ws.addRow(["Exportação de orçamentos: Luz Design"]);
    titulo.getCell(1).font = { bold: true, size: 14, color: { argb: COR_CABECALHO } };
    titulo.commit();
    ws.addRow([]).commit();
    kv("Exportado em", dataExcelMaceio(meta.exportadoEm), FORMATO_DATA_HORA);
    kv("Exportado por", meta.exportadoPor);
    kv("Período e filtros", meta.filtros.length > 0 ? meta.filtros.join("; ") : "Nenhum filtro");
    kv("Orçamentos de teste", meta.incluiuTeste ? "Incluídos" : "Fora da exportação");
    ws.addRow([]).commit();
    kv("Orçamentos exportados", total.qtd, "0");
    kv("Valor total", arred(total.valor), FORMATO_REAIS);
    kv("Vendido (fechados)", arred(total.vendido), FORMATO_REAIS);
    kv("Perdido (valor)", arred(total.perdido), FORMATO_REAIS);
    kv("Em aberto (valor)", arred(total.aberto), FORMATO_REAIS);
    kv("Em aberto (quantidade)", total.abertoQtd, "0");
    ws.addRow([]).commit();

    const cab = ws.addRow([
      "Por vendedora",
      "Orçamentos",
      "Valor total",
      "Enviados",
      "Fechados",
      "Vendido",
      "Perdidos",
      "Deixou de vender",
      "Em aberto",
      "Em aberto (R$)",
    ]);
    cab.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_CABECALHO } };
    });
    cab.commit();
    const nomes = [...porVendedora.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const escreve = (nome: string, s: Soma, negrito = false) => {
      const r = ws.addRow([
        nome,
        s.qtd,
        arred(s.valor),
        s.enviados,
        s.fechados,
        arred(s.vendido),
        s.perdidos,
        arred(s.perdido),
        s.abertoQtd,
        arred(s.aberto),
      ]);
      for (const col of [3, 6, 8, 10]) r.getCell(col).numFmt = FORMATO_REAIS;
      for (const col of [2, 4, 5, 7, 9]) r.getCell(col).numFmt = "0";
      if (negrito) r.font = { bold: true };
      r.commit();
    };
    // A vendedora exporta só os próprios dados: uma linha basta. A gerência vê uma por vendedora.
    for (const v of nomes) escreve(v.nome, v.soma);
    if (meta.gerencia && nomes.length > 1) escreve("Total", total, true);
    ws.addRow([]).commit();
    const nota = ws.addRow([
      "Enviados = tem data do primeiro envio. Vendido = valor fechado dos fechados. Em aberto = enviado e em follow-up.",
    ]);
    nota.getCell(1).font = { italic: true, color: { argb: "FF6B6B6B" } };
    nota.commit();
    ws.commit();
  }

  // ---------------------------------------------------------------- Orçamentos
  {
    const ws = novaAba(wb, "Orçamentos", COL_ORCAMENTOS);
    for (const o of orcs) {
      linha(ws, COL_ORCAMENTOS, [
        o.numero,
        o.vendedora_nome ?? "",
        o.cliente_nome ?? "",
        o.cliente_whatsapp ?? "",
        rotuloTipo(o.cliente_tipo),
        o.arquiteto_indicador ?? "",
        o.endereco ?? "",
        rotuloStatus(o.status),
        arred(o.valor_total),
        o.valor_fechado === null ? null : arred(o.valor_fechado),
        o.motivo_perda ? rotuloMotivo(o.motivo_perda) : "",
        dataExcelMaceio(o.criado_em),
        dataExcelMaceio(o.gerado_em),
        dataExcelMaceio(o.enviado_em),
        dataExcelMaceio(o.ultimo_envio_em),
        dataExcelMaceio(o.fechado_em),
        dataExcelMaceio(o.perdido_em),
        dataSimplesExcel(o.validade),
        simNao(estaVencido(o.status, o.validade, hoje)),
        o.pdf_versao,
      ]);
    }
    ws.commit();
  }

  // ---------------------------------------------------------------- Itens (em lotes)
  let totalItens = 0;
  {
    const numeroDe = new Map(orcs.map((o) => [o.id, o.numero]));
    const colunasItens = meta.gerencia ? [...COL_ITENS, ...COL_ITENS_GERENCIA] : COL_ITENS;
    const ws = novaAba(wb, "Itens", colunasItens);
    for (let i = 0; i < orcs.length; i += TAMANHO_LOTE) {
      const ids = orcs.slice(i, i + TAMANHO_LOTE).map((o) => o.id);
      for (const it of await fonte.itens(ids)) {
        const qtd = Number(it.quantidade);
        const preco = Number(it.preco_unitario);
        linha(ws, colunasItens, [
          numeroDe.get(it.orcamento_id) ?? "",
          it.ambiente ?? "",
          it.codigo ?? "",
          it.descricao,
          qtd,
          it.unidade,
          arred(preco),
          arred(qtd * preco),
          simNao(it.avulso),
          ROTULOS_ORIGEM[it.origem ?? "manual"] ?? it.origem ?? "",
          ...(meta.gerencia ? [it.fabricante ?? "", it.referencia_fabricante ?? ""] : []),
        ]);
        totalItens++;
      }
    }
    ws.commit();
  }

  // ---------------------------------------------------------------- Clientes
  {
    const ws = novaAba(wb, "Clientes", COL_CLIENTES);
    const lista = [...porCliente.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    for (const c of lista) {
      linha(ws, COL_CLIENTES, [
        c.nome,
        c.whatsapp ?? "",
        rotuloTipo(c.tipo),
        c.arquiteto ?? "",
        c.endereco ?? "",
        c.orcamentos,
        c.enviados,
        c.fechados,
        arred(c.vendido),
        dataExcelMaceio(c.ultimo),
      ]);
    }
    ws.commit();
  }

  // ---------------------------------------------------------------- Eventos (só a gerência)
  let totalEventos = 0;
  if (meta.gerencia && fonte.eventos) {
    const dadosOrc = new Map(orcs.map((o) => [o.id, o]));
    const ws = novaAba(wb, "Eventos", COL_EVENTOS);
    for (let i = 0; i < orcs.length; i += TAMANHO_LOTE) {
      const ids = orcs.slice(i, i + TAMANHO_LOTE).map((o) => o.id);
      for (const ev of await fonte.eventos(ids)) {
        const o = dadosOrc.get(ev.orcamento_id);
        linha(ws, COL_EVENTOS, [
          o?.numero ?? "",
          o?.vendedora_nome ?? "",
          ev.de_status ? rotuloStatus(ev.de_status) : "",
          rotuloStatus(ev.para_status),
          dataExcelMaceio(ev.criado_em),
          ev.quem ?? "",
        ]);
        totalEventos++;
      }
    }
    ws.commit();
  }

  // ---------------------------------------------------------------- Arquitetos (só a gerência)
  let totalArquitetos = 0;
  if (meta.gerencia && fonte.arquitetos) {
    const soma = new Map<
      string,
      { indicados: number; fechados: number; vendido: number; ultimo: string }
    >();
    for (const o of orcs) {
      if (!o.arquiteto_id) continue;
      const s = soma.get(o.arquiteto_id) ?? {
        indicados: 0,
        fechados: 0,
        vendido: 0,
        ultimo: o.criado_em,
      };
      if (o.status !== "rascunho") s.indicados++;
      if (o.status === "fechado") {
        s.fechados++;
        s.vendido += o.valor_fechado ?? o.valor_total;
      }
      if (o.criado_em > s.ultimo) s.ultimo = o.criado_em;
      soma.set(o.arquiteto_id, s);
    }
    const ws = novaAba(wb, "Arquitetos", COL_ARQUITETOS);
    const lista = [...(await fonte.arquitetos())].sort((a, b) =>
      a.nome.localeCompare(b.nome, "pt-BR"),
    );
    for (const a of lista) {
      const s = soma.get(a.id);
      linha(ws, COL_ARQUITETOS, [
        a.nome,
        a.escritorio ?? "",
        a.whatsapp ?? "",
        a.email ?? "",
        a.aniversario_dia && a.aniversario_mes
          ? `${String(a.aniversario_dia).padStart(2, "0")}/${String(a.aniversario_mes).padStart(2, "0")}`
          : "",
        a.ativo ? "Sim" : "Não",
        s?.indicados ?? 0,
        s?.fechados ?? 0,
        arred(s?.vendido ?? 0),
        s ? dataExcelMaceio(s.ultimo) : null,
      ]);
      totalArquitetos++;
    }
    ws.commit();
  }

  const contagem: ContagemExportacao = {
    orcamentos: orcs.length,
    itens: totalItens,
    clientes: porCliente.size,
    eventos: totalEventos,
    arquitetos: totalArquitetos,
  };
  await meta.aoFinalizar?.(contagem);
  await wb.commit();
  return contagem;
}
