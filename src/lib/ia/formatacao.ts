import "server-only";
import {
  inicioDoDiaMaceio,
  mensagemAmigavelErro,
  type DepsIA,
  type DescricaoFormatadaNova,
} from "./comum";
import { estimarCustoUsd } from "./config";
import { ESQUEMA_JSON_FORMATACAO, schemaFormatacaoIA } from "./esquema";
import { executarMotor, type ResultadoMotor } from "./motor";

/**
 * Formatação pela IA: SÓ texto. Padroniza a descrição comercial dos produtos e o nome dos
 * ambientes. Nunca adiciona, remove ou troca item e não mexe em quantidade nem em preço. Qualquer
 * falha cai na descrição do catálogo e NUNCA bloqueia a geração do orçamento.
 */
export const INSTRUCOES_FORMATACAO = `Você padroniza textos de orçamentos da Luz Design, loja de iluminação em Maceió (AL). Você NÃO escolhe produtos, NÃO muda quantidades e NÃO fala de preço: só reescreve texto.

Tarefa 1, descrição comercial dos produtos: para cada produto (código, categoria e descrição do catálogo), escreva uma descrição comercial curta em português do Brasil, com as abreviações abertas e a grafia correta. Exemplo: "EMB DICR MR16 GU10 BR" vira "Embutido para dicroica MR16 GU10, branco".
- Mantenha TODOS os números e medidas da descrição original (potência, temperatura de cor, mm, V, metros, códigos de modelo) exatamente como estão, sem converter nem arredondar. Não acrescente números novos.
- USE A CATEGORIA para saber o que o produto é e nunca troque o tipo do produto: LED = lâmpada (por exemplo, "Lâmpada dicroica LED 6 W", "Lâmpada P20 7 W", "Lâmpada mini 3,5 W"); EMBUTIDO = luminária de embutir; SPOT = spot; FITA LED = fita LED vendida por metro; PERFIL = perfil de alumínio; FONTE = fonte de alimentação; PLAFON, ARANDELA, PENDENTE, TRILHO = o próprio nome. P20 e AR70/AR111 são tipos de lâmpada refletora: escreva como aparecem ("P20"), sem trocar por outro nome.
- Mantenha a marca e o modelo como aparecem. Não invente características que a descrição original não diz.
- Uma linha só, no máximo cerca de 120 caracteres.

Tarefa 2, nomes de ambiente: devolva o mesmo nome com maiúsculas e acentos corretos (por exemplo "quarto casal" vira "Quarto casal", "SUITE" vira "Suíte"). Não troque palavras nem acrescente nada.

Responda SOMENTE com o JSON do esquema pedido, com um registro para cada código e cada ambiente recebido.`;

// ---------------------------------------------------------------- validação (pura)

/** Números do texto como texto normalizado ("3,0" e "3.0" contam igual), em ordem. */
export function numerosDoTexto(texto: string): string[] {
  return (texto.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}

/** Os dois textos têm exatamente os mesmos números (mesmas quantidades de cada um). */
export function mesmosNumeros(original: string, formatado: string): boolean {
  const a = numerosDoTexto(original).sort();
  const b = numerosDoTexto(formatado).sort();
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** A descrição formatada só vale se mantém todos os números e tem um tamanho razoável. */
export function descricaoFormatadaValida(original: string, formatada: string): boolean {
  const f = formatada.replace(/\s+/g, " ").trim();
  if (f.length < 3 || f.length > 200) return false;
  return mesmosNumeros(original, f);
}

const semAcento = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** O nome formatado do ambiente só pode mudar maiúsculas e acentos. */
export function nomeAmbienteFormatadoValido(original: string, formatado: string): boolean {
  const f = formatado.replace(/\s+/g, " ").trim();
  return f.length >= 1 && f.length <= 60 && semAcento(f) === semAcento(original);
}

/** Nome de ambiente que provavelmente precisa de ajuste (minúsculo no começo ou tudo em maiúsculas). */
export function ambienteParecePrecisarDeAjuste(nome: string): boolean {
  const n = nome.trim();
  if (!n) return false;
  const letras = n.replace(/[^\p{L}]/gu, "");
  return n[0] !== n[0].toUpperCase() || (letras.length > 3 && letras === letras.toUpperCase());
}

// ---------------------------------------------------------------- execução

export interface ProdutoParaFormatar {
  codigo: string;
  /** Categoria do catálogo (LED, EMBUTIDO, FITA LED...): diz o que o produto é. */
  categoria?: string | null;
  /** Descrição do catálogo. */
  descricao: string;
  atualizado_em?: string;
}

export interface ResultadoFormatacao {
  /** código -> descrição final (padronizada, ou a do catálogo se não deu). */
  descricoes: Map<string, string>;
  /** nome original do ambiente -> nome padronizado (só os que mudaram). */
  ambientes: Map<string, string>;
  chamouIA: boolean;
  custoUsd: number;
  avisos: string[];
}

/**
 * Descrição final de cada produto: a padronizada guardada (se ainda vale para a descrição atual do
 * catálogo) ou, para os códigos pendentes, uma única chamada à IA com todos juntos.
 */
export async function formatarTextos(
  deps: DepsIA,
  usuarioId: string,
  orcamentoId: string,
  entrada: { produtos: ProdutoParaFormatar[]; ambientes: string[] },
): Promise<ResultadoFormatacao> {
  const { repo, config } = deps;
  const agora = (deps.agora ?? (() => new Date()))();
  const resultado: ResultadoFormatacao = {
    descricoes: new Map(),
    ambientes: new Map(),
    chamouIA: false,
    custoUsd: 0,
    avisos: [],
  };
  for (const p of entrada.produtos) resultado.descricoes.set(p.codigo, p.descricao);

  const unicos = [...new Map(entrada.produtos.map((p) => [p.codigo, p])).values()];
  let guardadas = new Map<string, { descricao_formatada: string; descricao_origem: string }>();
  try {
    guardadas = await repo.descricoesFormatadas(unicos.map((p) => p.codigo));
  } catch {
    resultado.avisos.push("Não consegui ler as descrições padronizadas; usei as do catálogo.");
  }
  const pendentes: ProdutoParaFormatar[] = [];
  for (const p of unicos) {
    const g = guardadas.get(p.codigo);
    if (g && g.descricao_origem === p.descricao) {
      resultado.descricoes.set(p.codigo, g.descricao_formatada);
    } else pendentes.push(p);
  }
  const ambientesParaAjustar = entrada.ambientes.filter(ambienteParecePrecisarDeAjuste);

  if (pendentes.length === 0 && ambientesParaAjustar.length === 0) return resultado;

  let usoId: string | null = null;
  let motor: ResultadoMotor | null = null;
  const t0 = Date.now();
  try {
    const usoDoDia = await repo.contarUso({
      vendedoraId: usuarioId,
      desde: inicioDoDiaMaceio(agora),
    });
    if (usoDoDia >= config.limiteDiario) {
      resultado.avisos.push("Limite diário da IA atingido: usei as descrições do catálogo.");
      return resultado;
    }
    usoId = await repo.iniciarUso({
      orcamentoId,
      vendedoraId: usuarioId,
      modelo: config.modelo,
      tipo: "formatacao",
    });

    // Só o catálogo (código + descrição) e os nomes de ambiente vão para a IA: nada do cliente.
    const texto = JSON.stringify({
      produtos: pendentes.map((p) => ({
        codigo: p.codigo,
        categoria: p.categoria ?? null,
        descricao: p.descricao,
      })),
      ambientes: entrada.ambientes,
    });
    motor = await executarMotor({
      cliente: deps.ia,
      modelo: config.modelo,
      instrucoes: INSTRUCOES_FORMATACAO,
      conteudo: [{ type: "input_text", text: texto }],
      executor: deps.executor,
      maxRodadas: 0,
      raciocinio: config.raciocinio,
      timeoutMs: config.timeoutChamadaMs,
      esquema: ESQUEMA_JSON_FORMATACAO,
      nomeEsquema: "formatacao_luz_design",
      usarFerramentas: false,
    });
    resultado.chamouIA = true;

    const saida = schemaFormatacaoIA.parse(JSON.parse(motor.textoFinal));
    const novas: DescricaoFormatadaNova[] = [];
    const porCodigo = new Map(pendentes.map((p) => [p.codigo, p]));
    for (const f of saida.produtos) {
      const origem = porCodigo.get(f.codigo);
      if (!origem) continue; // código que não pedi: ignorado
      if (!descricaoFormatadaValida(origem.descricao, f.descricao_formatada)) {
        resultado.avisos.push(
          `A descrição padronizada de ${f.codigo} perdeu números ou medidas; usei a do catálogo.`,
        );
        continue;
      }
      const limpa = f.descricao_formatada.replace(/\s+/g, " ").trim();
      resultado.descricoes.set(f.codigo, limpa);
      novas.push({
        codigo: f.codigo,
        descricao_formatada: limpa,
        descricao_origem: origem.descricao,
        origem_atualizado_em: origem.atualizado_em ?? agora.toISOString(),
      });
    }
    for (const a of saida.ambientes) {
      const original = entrada.ambientes.find((n) => n === a.original);
      if (!original) continue;
      const f = a.formatado.replace(/\s+/g, " ").trim();
      if (f !== original && nomeAmbienteFormatadoValido(original, f)) {
        resultado.ambientes.set(original, f);
      }
    }
    await repo.salvarDescricoesFormatadas(novas).catch(() => {
      resultado.avisos.push("Não consegui guardar as descrições padronizadas para a próxima vez.");
    });

    const { custo, conhecido } = estimarCustoUsd(config, motor.tokensEntrada, motor.tokensSaida);
    resultado.custoUsd = custo;
    await repo.finalizarUso(usoId, {
      status: "ok",
      tokens_entrada: motor.tokensEntrada,
      tokens_saida: motor.tokensSaida,
      custo_estimado: custo,
      duracao_ms: Date.now() - t0,
      chamadas_ferramenta: 0,
      detalhes: {
        tipo: "formatacao",
        produtos: pendentes.length,
        ambientes: entrada.ambientes.length,
        aceitas: novas.length,
        avisos: resultado.avisos,
        custo_conhecido: conhecido,
      },
    });
  } catch (e) {
    // A formatação nunca bloqueia: fica o texto do catálogo.
    resultado.avisos.push(`${mensagemAmigavelErro(e)} Usei as descrições do catálogo.`);
    if (usoId) {
      await repo
        .finalizarUso(usoId, {
          status: "erro",
          tokens_entrada: motor?.tokensEntrada ?? 0,
          tokens_saida: motor?.tokensSaida ?? 0,
          custo_estimado: 0,
          duracao_ms: Date.now() - t0,
          chamadas_ferramenta: 0,
          erro: (e instanceof Error ? e.message : String(e)).slice(0, 500),
          detalhes: { tipo: "formatacao" },
        })
        .catch(() => undefined);
    }
  }
  return resultado;
}
