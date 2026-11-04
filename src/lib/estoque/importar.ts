import type { UnidadeProduto } from "../dominio";
import type { ErroLinha, PreviaImportacao, ProdutoImportacao, ResumoImportacao } from "./tipos";

export interface ProdutoExistente {
  descricao: string;
  preco_unitario: number;
  categoria: string | null;
  marca: string | null;
  unidade: UnidadeProduto;
  estoque_disponivel: number | null;
  ativo: boolean;
}

export type LinhaProduto = Record<string, unknown> & { codigo: string };

/** Acesso ao banco, separado para permitir testes sem Supabase. */
export interface RepositorioEstoque {
  listarExistentes(): Promise<Map<string, ProdutoExistente>>;
  gravarProdutos(linhas: LinhaProduto[]): Promise<void>;
  gravarApelidos(linhas: { codigo: string; texto: string }[]): Promise<void>;
  desativar(codigos: string[]): Promise<void>;
  iniciarSync(origem: string): Promise<string>;
  finalizarSync(
    id: string,
    dados: { linhas_lidas: number; linhas_gravadas: number; erros: unknown[] },
  ): Promise<void>;
}

export interface OpcoesImportacao {
  origem: string;
  /** Marca como inativos os produtos ativos que não vieram na planilha. Nunca apaga. */
  desativarAusentes?: boolean;
  linhasLidas: number;
  /** Erros de validação (linhas já descartadas antes de chegar aqui). */
  erros?: ErroLinha[];
  /** Códigos presentes na planilha, inclusive os de linhas inválidas. Padrão: os dos produtos. */
  codigosVistos?: string[];
}

const TAMANHO_LOTE = 500;
const MAX_ERROS_GRAVADOS = 500;

function lotes<T>(itens: T[]): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < itens.length; i += TAMANHO_LOTE) r.push(itens.slice(i, i + TAMANHO_LOTE));
  return r;
}

/** Última ocorrência de cada código vence; as anteriores viram erro de linha. */
function deduplicar(produtos: ProdutoImportacao[]) {
  const ultimo = new Map<string, number>();
  produtos.forEach((p, i) => ultimo.set(p.codigo, i));
  const unicos: ProdutoImportacao[] = [];
  let repetidos = 0;
  produtos.forEach((p, i) => {
    if (ultimo.get(p.codigo) === i) unicos.push(p);
    else repetidos++;
  });
  return { unicos, repetidos };
}

function mudou(novo: ProdutoImportacao, antigo: ProdutoExistente): boolean {
  if (!antigo.ativo) return true;
  if (novo.descricao !== antigo.descricao) return true;
  if (Number(novo.preco_unitario) !== Number(antigo.preco_unitario)) return true;
  if (novo.categoria !== undefined && novo.categoria !== antigo.categoria) return true;
  if (novo.marca !== undefined && novo.marca !== antigo.marca) return true;
  if (novo.unidade !== undefined && novo.unidade !== antigo.unidade) return true;
  if (
    novo.estoque_disponivel !== undefined &&
    novo.estoque_disponivel !== antigo.estoque_disponivel
  )
    return true;
  return false;
}

function classificar(unicos: ProdutoImportacao[], existentes: Map<string, ProdutoExistente>) {
  const novos: ProdutoImportacao[] = [];
  const alterados: ProdutoImportacao[] = [];
  const iguais: ProdutoImportacao[] = [];
  let reativados = 0;
  for (const p of unicos) {
    const antigo = existentes.get(p.codigo);
    if (!antigo) novos.push(p);
    else if (mudou(p, antigo)) {
      alterados.push(p);
      if (!antigo.ativo) reativados++;
    } else iguais.push(p);
  }
  return { novos, alterados, iguais, reativados };
}

/** O que a carga faria, sem gravar nada. */
export async function previa(
  repo: RepositorioEstoque,
  produtos: ProdutoImportacao[],
  codigosVistos?: string[],
): Promise<PreviaImportacao> {
  const { unicos } = deduplicar(produtos);
  const existentes = await repo.listarExistentes();
  const c = classificar(unicos, existentes);
  const vistos = new Set(codigosVistos ?? unicos.map((p) => p.codigo));
  const ausentes = [...existentes].filter(([codigo, e]) => e.ativo && !vistos.has(codigo)).length;
  return {
    novos: c.novos.length,
    alterados: c.alterados.length,
    iguais: c.iguais.length,
    reativados: c.reativados,
    ausentes,
  };
}

/** Só inclui um campo opcional se algum produto da carga o trouxe: assim ele não é zerado. */
function montarLinhas(produtos: ProdutoImportacao[]): LinhaProduto[] {
  const tem = (campo: keyof ProdutoImportacao) => produtos.some((p) => p[campo] !== undefined);
  const incluir = {
    categoria: tem("categoria"),
    marca: tem("marca"),
    unidade: tem("unidade"),
    estoque_disponivel: tem("estoque_disponivel"),
    atributos: tem("atributos"),
  };
  return produtos.map((p) => {
    const linha: LinhaProduto = {
      codigo: p.codigo,
      descricao: p.descricao,
      preco_unitario: p.preco_unitario,
      ativo: true,
    };
    if (incluir.categoria) linha.categoria = p.categoria ?? null;
    if (incluir.marca) linha.marca = p.marca ?? null;
    if (incluir.unidade && p.unidade) linha.unidade = p.unidade;
    if (incluir.estoque_disponivel) linha.estoque_disponivel = p.estoque_disponivel ?? null;
    if (incluir.atributos) linha.atributos = p.atributos ?? {};
    return linha;
  });
}

export async function importar(
  repo: RepositorioEstoque,
  produtos: ProdutoImportacao[],
  opcoes: OpcoesImportacao,
): Promise<ResumoImportacao> {
  const erros: ErroLinha[] = [...(opcoes.erros ?? [])];
  const { unicos, repetidos } = deduplicar(produtos);
  if (repetidos > 0)
    erros.push({
      linha: 0,
      mensagem: `${repetidos} linha(s) com código repetido: vale a última de cada código.`,
    });

  const syncId = await repo.iniciarSync(opcoes.origem);
  let gravadas = 0;
  let novos = 0;
  let alterados = 0;
  let iguais = 0;
  let desativados = 0;

  try {
    const existentes = await repo.listarExistentes();
    const c = classificar(unicos, existentes);
    novos = c.novos.length;
    alterados = c.alterados.length;
    iguais = c.iguais.length;

    // Linhas iguais não são reescritas (preserva atualizado_em); apelidos entram para todos.
    const aGravar = [...c.novos, ...c.alterados];
    for (const lote of lotes(montarLinhas(aGravar))) {
      await repo.gravarProdutos(lote);
      gravadas += lote.length;
    }

    const apelidos = unicos.flatMap((p) =>
      [...new Set(p.apelidos ?? [])]
        .filter((t) => t && t !== p.descricao)
        .map((texto) => ({ codigo: p.codigo, texto })),
    );
    for (const lote of lotes(apelidos)) await repo.gravarApelidos(lote);

    if (opcoes.desativarAusentes) {
      const vistos = new Set(opcoes.codigosVistos ?? unicos.map((p) => p.codigo));
      const ausentes = [...existentes]
        .filter(([cod, e]) => e.ativo && !vistos.has(cod))
        .map(([cod]) => cod);
      for (const lote of lotes(ausentes)) await repo.desativar(lote);
      desativados = ausentes.length;
    }

    await repo.finalizarSync(syncId, {
      linhas_lidas: opcoes.linhasLidas,
      linhas_gravadas: gravadas,
      erros: erros.slice(0, MAX_ERROS_GRAVADOS),
    });
  } catch (e) {
    await repo
      .finalizarSync(syncId, {
        linhas_lidas: opcoes.linhasLidas,
        linhas_gravadas: gravadas,
        erros: [
          ...erros.slice(0, MAX_ERROS_GRAVADOS),
          { linha: 0, mensagem: `Falha: ${(e as Error).message}` },
        ],
      })
      .catch(() => undefined);
    throw e;
  }

  return {
    syncId,
    linhasLidas: opcoes.linhasLidas,
    linhasGravadas: gravadas,
    novos,
    alterados,
    iguais,
    desativados,
    erros,
  };
}
