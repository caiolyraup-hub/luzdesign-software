// Backup sem Docker e sem pg_dump (dia 14): lê o banco pela API (service role), um JSON por tabela, e
// copia os arquivos do Storage com o mesmo caminho. O manifesto guarda contagens, tamanhos e somas
// de verificação, para o `backup:conferir` provar que a cópia está inteira.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Todas as tabelas do schema public, com a coluna usada para paginar de forma estável. */
export const TABELAS: { nome: string; ordem: string }[] = [
  { nome: "usuarios", ordem: "id" },
  { nome: "produtos", ordem: "codigo" },
  { nome: "produto_apelidos", ordem: "id" },
  { nome: "produtos_dados_fornecedor", ordem: "codigo" },
  { nome: "produtos_descricao_formatada", ordem: "codigo" },
  { nome: "sync_estoque", ordem: "id" },
  { nome: "estoque_mapeamentos", ordem: "id" },
  { nome: "configuracoes_loja", ordem: "id" },
  { nome: "configuracoes_comissao", ordem: "id" },
  { nome: "arquitetos", ordem: "id" },
  { nome: "eventos_arquiteto", ordem: "id" },
  { nome: "clientes", ordem: "id" },
  { nome: "clientes_fusoes", ordem: "id" },
  { nome: "orcamento_contador", ordem: "ano" },
  { nome: "orcamentos", ordem: "id" },
  { nome: "orcamento_itens", ordem: "id" },
  { nome: "orcamento_ambientes", ordem: "id" },
  { nome: "anexos", ordem: "id" },
  { nome: "eventos", ordem: "id" },
  { nome: "indicacoes_ia", ordem: "id" },
  { nome: "uso_ia", ordem: "id" },
  { nome: "eventos_exportacao", ordem: "id" },
  { nome: "consultas_referencia", ordem: "id" },
  { nome: "comissoes", ordem: "id" },
  { nome: "comissoes_arquiteto_percentual", ordem: "arquiteto_id" },
  { nome: "comissoes_vendedora_percentual", ordem: "vendedora_id" },
  { nome: "erros_app", ordem: "id" },
  { nome: "relatos_piloto", ordem: "id" },
];
export const BUCKETS = ["anexos", "pdfs", "arquitetos", "relatos"];
export const LOTE = 1000;

export type Linha = Record<string, unknown>;
export interface ContaAuth {
  id: string;
  email: string | null;
  criado_em: string | null;
  ultimo_login: string | null;
  metadata: Record<string, unknown> | null;
}
export interface FonteBackup {
  lerTabela(nome: string, ordem: string, de: number, quantidade: number): Promise<Linha[]>;
  contasAuth(): Promise<ContaAuth[]>;
  listarArquivos(bucket: string): Promise<{ caminho: string }[]>;
  baixarArquivo(bucket: string, caminho: string): Promise<Uint8Array>;
  ultimaMigration(): Promise<string | null>;
}

export interface Manifesto {
  versao: 1;
  criado_em: string;
  projeto: string;
  commit: string;
  ultima_migration: string | null;
  tabelas: Record<string, { linhas: number; bytes: number; sha256: string }>;
  auth: { contas: number; arquivo: string; sha256: string };
  storage: Record<
    string,
    { arquivos: number; bytes: number; lista: { caminho: string; bytes: number; sha256: string }[] }
  >;
  totais: {
    orcamentos: number;
    orcamentos_por_status: Record<string, { quantidade: number; valor_centavos: number }>;
  };
}

export const sha256 = (dados: string | Uint8Array) =>
  createHash("sha256").update(dados).digest("hex");
export const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** Totais dos orçamentos por status (quantidade e valor em centavos): o mesmo cálculo nos dois lados. */
export function totaisDosOrcamentos(orcamentos: Linha[]): Manifesto["totais"] {
  const por: Manifesto["totais"]["orcamentos_por_status"] = {};
  for (const o of orcamentos) {
    const s = String(o.status);
    por[s] ??= { quantidade: 0, valor_centavos: 0 };
    por[s].quantidade += 1;
    por[s].valor_centavos += centavos(o.valor_total);
  }
  return { orcamentos: orcamentos.length, orcamentos_por_status: por };
}

function gravar(pasta: string, relativo: string, conteudo: string | Uint8Array) {
  const destino = path.join(pasta, relativo);
  mkdirSync(path.dirname(destino), { recursive: true });
  writeFileSync(destino, conteudo);
}

export async function fazerBackup(opcoes: {
  fonte: FonteBackup;
  pasta: string;
  projeto: string;
  commit: string;
  agora?: Date;
  aoProgredir?: (msg: string) => void;
}): Promise<Manifesto> {
  const { fonte, pasta } = opcoes;
  const log = opcoes.aoProgredir ?? (() => {});
  const manifesto: Manifesto = {
    versao: 1,
    criado_em: (opcoes.agora ?? new Date()).toISOString(),
    projeto: opcoes.projeto,
    commit: opcoes.commit,
    ultima_migration: await fonte.ultimaMigration(),
    tabelas: {},
    auth: { contas: 0, arquivo: "auth_usuarios.json", sha256: "" },
    storage: {},
    totais: { orcamentos: 0, orcamentos_por_status: {} },
  };

  for (const { nome, ordem } of TABELAS) {
    const todas: Linha[] = [];
    for (let de = 0; ; de += LOTE) {
      const lote = await fonte.lerTabela(nome, ordem, de, LOTE);
      todas.push(...lote);
      if (lote.length < LOTE) break;
    }
    const json = JSON.stringify(todas);
    gravar(pasta, `tabelas/${nome}.json`, json);
    manifesto.tabelas[nome] = {
      linhas: todas.length,
      bytes: Buffer.byteLength(json),
      sha256: sha256(json),
    };
    if (nome === "orcamentos") manifesto.totais = totaisDosOrcamentos(todas);
    log(`  ${nome}: ${todas.length} linha(s)`);
  }

  const contas = await fonte.contasAuth();
  const jsonAuth = JSON.stringify(contas);
  gravar(pasta, manifesto.auth.arquivo, jsonAuth);
  manifesto.auth = {
    contas: contas.length,
    arquivo: manifesto.auth.arquivo,
    sha256: sha256(jsonAuth),
  };
  log(`  contas (Auth): ${contas.length} (sem senhas: a API não as entrega)`);

  for (const bucket of BUCKETS) {
    const lista: Manifesto["storage"][string]["lista"] = [];
    for (const { caminho } of await fonte.listarArquivos(bucket)) {
      const bytes = await fonte.baixarArquivo(bucket, caminho);
      gravar(pasta, `storage/${bucket}/${caminho}`, bytes);
      lista.push({ caminho, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
    manifesto.storage[bucket] = {
      arquivos: lista.length,
      bytes: lista.reduce((s, f) => s + f.bytes, 0),
      lista,
    };
    log(`  storage/${bucket}: ${lista.length} arquivo(s)`);
  }

  gravar(pasta, "manifesto.json", JSON.stringify(manifesto, null, 2));
  return manifesto;
}
