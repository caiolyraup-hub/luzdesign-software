/**
 * Kit de fita LED (fita + perfil + fonte), calculado sem IA.
 *
 * Padrão observado nos 37 orçamentos reais (relatório do dia 7 e src/lib/ia/instrucoes-indicacao.ts):
 *  - perfil acompanha a fita, 1 metro de perfil para cada metro de fita, em barras de 2 m ou 3 m;
 *  - fonte = W/m da fita x metros x margem (1,2; a mediana real é 1,36 e o mínimo 1,1);
 *  - a descrição das fontes do catálogo nem sempre informa a tensão (12/24 V): quando falta, o
 *    sistema sugere e pede para confirmar (não bloqueia, não chuta).
 * O preço nunca é calculado aqui: o servidor lê o preço do catálogo ao adicionar os itens.
 */

export type UnidadeKit = "un" | "m";

export interface ProdutoKit {
  codigo: string;
  descricao: string;
  categoria: string | null;
  unidade: UnidadeKit;
  preco: number;
  atributos: Record<string, unknown>;
}

/** Margem sobre a carga da fita para escolher a fonte. */
export const MARGEM_FONTE = 1.2;
/** Maior metragem aceita no kit (proteção contra digitação errada). */
export const MAX_METROS_KIT = 500;

const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const dec = (s: string) => Number(s.replace(",", "."));

// ---------------------------------------------------------------- parser dos dados do produto

/** Potência em W: `atributos.w` e, na falta, o primeiro "NNW" ou "NN,NW" da descrição ("7,2W", "22W/M"). */
export function potenciaW(p: Pick<ProdutoKit, "atributos" | "descricao">): number | null {
  const a = numero(p.atributos.w);
  if (a !== null) return a;
  const m = /(\d+(?:[.,]\d+)?)\s*W(?![A-Za-z])/i.exec(p.descricao);
  return m ? numero(m[1]) : null;
}

/**
 * Tensão em V: `atributos.v` / `atributos.tensao` e, na falta, "12V", "24 V", "24VDC", "220V" da
 * descrição. Só aceita tensões que existem em iluminação (12, 24, 127, 220, 240...).
 */
export function tensaoV(p: Pick<ProdutoKit, "atributos" | "descricao">): number | null {
  const a = numero(p.atributos.v) ?? numero(p.atributos.tensao);
  if (a !== null) return a;
  const m = /(?<![\d.,])(\d{2,3})\s*V(?:DC|CC|AC|CA)?(?![A-Za-z])/i.exec(p.descricao);
  if (!m) return null;
  const v = Number(m[1]);
  return [5, 12, 24, 36, 48, 110, 127, 220, 240].includes(v) ? v : null;
}

/** Fita ligada direto na rede (110 a 240 V) não leva fonte. */
export const tensaoDeRede = (v: number | null) => v !== null && v >= 100;

/**
 * Comprimento em metros: `atributos.comprimento` (perfil, barra) ou `atributos.comprimento_rolo` e,
 * na falta, "2M", "3MTS", "5 METROS" da descrição.
 */
export function comprimentoM(
  p: Pick<ProdutoKit, "atributos" | "descricao">,
  chave: "comprimento" | "comprimento_rolo" = "comprimento",
): number | null {
  const a = numero(p.atributos[chave]);
  if (a !== null) return a;
  const m = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:M(?:TS?|ETROS?)?)(?![A-Za-z])/i.exec(p.descricao);
  return m ? numero(m[1]) : null;
}

// ---------------------------------------------------------------- entrada de metros

/** "5", "5,5", "5.25" -> metros (2 casas); inválido, zero ou além de 500 m -> erro. */
export function lerMetros(
  texto: string,
): { ok: true; metros: number } | { ok: false; erro: string } {
  const t = texto.trim().replace(/\s*m(?:etros?|ts?)?$/i, "");
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(t))
    return { ok: false, erro: "Informe os metros, por exemplo 5 ou 5,5." };
  const metros = Math.round(dec(t) * 100) / 100;
  if (metros <= 0) return { ok: false, erro: "Os metros precisam ser maiores que zero." };
  if (metros > MAX_METROS_KIT)
    return { ok: false, erro: `Use até ${MAX_METROS_KIT} metros por kit.` };
  return { ok: true, metros };
}

// ---------------------------------------------------------------- cálculo

export interface LinhaKit {
  produto: ProdutoKit;
  /** Quantidade na unidade do produto (m com 2 casas, ou unidades inteiras). */
  quantidade: number;
  /** Como a conta foi feita, para mostrar à vendedora. */
  conta: string;
}

export type FonteKit =
  | {
      tipo: "sugerida";
      linha: LinhaKit;
      cargaW: number;
      necessariaW: number;
      /** A tensão não aparece no catálogo (da fita, da fonte ou das duas): confirmar. */
      confirmarTensao: boolean;
    }
  | {
      /** A vendedora escolhe a fonte; `motivo` diz o que faltou. */
      tipo: "escolher";
      motivo: string;
      cargaW: number | null;
      necessariaW: number | null;
    }
  | { tipo: "nao_precisa"; motivo: string };

export interface ResultadoKit {
  metros: number;
  fita: LinhaKit | { produto: ProdutoKit; quantidade: null; conta: string };
  perfil: LinhaKit | { produto: ProdutoKit; quantidade: null; conta: string } | null;
  fonte: FonteKit;
  /** O que faltou para calcular algo (potência, comprimento...). */
  avisos: string[];
}

const arred2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => String(arred2(n)).replace(".", ",");
/** Evita 2.0000000001 virar 3 barras no arredondamento para cima. */
const teto = (n: number) => Math.ceil(Math.round(n * 1e6) / 1e6);

function quantidadePorMetro(
  produto: ProdutoKit,
  metros: number,
  rotulo: string,
  chaveComprimento: "comprimento" | "comprimento_rolo",
  avisos: string[],
): { produto: ProdutoKit; quantidade: number | null; conta: string } {
  if (produto.unidade === "m") {
    return { produto, quantidade: arred2(metros), conta: `${fmt(metros)} m de ${rotulo}` };
  }
  const c = comprimentoM(produto, chaveComprimento);
  if (c === null) {
    avisos.push(
      `Falta o comprimento ${rotulo === "fita" ? "do rolo" : "da barra"} de ${produto.codigo}: informe a quantidade.`,
    );
    return { produto, quantidade: null, conta: `${fmt(metros)} m de ${rotulo}, sem o comprimento` };
  }
  const n = teto(metros / c);
  return {
    produto,
    quantidade: n,
    conta: `${fmt(metros)} m ÷ ${fmt(c)} m = ${n} ${rotulo === "fita" ? (n === 1 ? "rolo" : "rolos") : n === 1 ? "barra" : "barras"}`,
  };
}

type Compat = "sim" | "confirmar" | "nao";
function tensaoCompativel(fita: number | null, fonte: number | null): Compat {
  if (fita === null || fonte === null) return "confirmar";
  return fita === fonte ? "sim" : "nao";
}

/**
 * Escolhe a fonte: a menor do catálogo com potência suficiente (e tensão compatível). Se a carga passa
 * da maior, divide em N fontes iguais. Sem potência da fita, a vendedora escolhe.
 */
export function escolherFonte(
  fita: ProdutoKit,
  metros: number,
  fontes: ProdutoKit[],
  margem = MARGEM_FONTE,
): FonteKit {
  const tensaoFita = tensaoV(fita);
  if (tensaoDeRede(tensaoFita))
    return {
      tipo: "nao_precisa",
      motivo: `A fita é de ${tensaoFita} V (ligada na rede): não leva fonte.`,
    };

  const wPorMetro = potenciaW(fita);
  if (wPorMetro === null) {
    return {
      tipo: "escolher",
      motivo: `Falta a potência (W por metro) da fita ${fita.codigo}: escolha a fonte.`,
      cargaW: null,
      necessariaW: null,
    };
  }
  const cargaW = arred2(wPorMetro * metros);
  const necessariaW = arred2(cargaW * margem);

  const candidatas = fontes
    .map((f) => ({ f, w: potenciaW(f), compat: tensaoCompativel(tensaoFita, tensaoV(f)) }))
    .filter(
      (x): x is { f: ProdutoKit; w: number; compat: Compat } => x.w !== null && x.compat !== "nao",
    )
    .sort((a, b) => a.w - b.w || a.f.preco - b.f.preco);
  if (candidatas.length === 0) {
    return {
      tipo: "escolher",
      motivo:
        fontes.length === 0
          ? "Não há fonte no catálogo: escolha a fonte."
          : "Nenhuma fonte do catálogo informa a potência ou a tensão da fita: escolha a fonte.",
      cargaW,
      necessariaW,
    };
  }

  // Uma fonte só, se alguma aguenta; senão N fontes iguais, cada uma com a sua parte da carga.
  const maior = candidatas[candidatas.length - 1].w;
  let n = 1;
  let parte = necessariaW;
  if (necessariaW > maior + 1e-9) {
    n = teto(necessariaW / maior);
    parte = necessariaW / n;
  }
  const escolhida = candidatas.find((x) => x.w + 1e-9 >= parte)!;
  const confirmarTensao = escolhida.compat === "confirmar";
  const conta =
    n === 1
      ? `${fmt(metros)} m × ${fmt(wPorMetro)} W/m = ${fmt(cargaW)} W; com margem de ${fmt((margem - 1) * 100)}%: ${fmt(necessariaW)} W; fonte de ${fmt(escolhida.w)} W`
      : `${fmt(metros)} m × ${fmt(wPorMetro)} W/m = ${fmt(cargaW)} W; com margem: ${fmt(necessariaW)} W; passa da maior fonte: ${n} fontes de ${fmt(escolhida.w)} W`;
  return {
    tipo: "sugerida",
    linha: { produto: escolhida.f, quantidade: n, conta },
    cargaW,
    necessariaW,
    confirmarTensao,
  };
}

export interface EntradaKit {
  metros: number;
  fita: ProdutoKit;
  /** Null = sem perfil. */
  perfil: ProdutoKit | null;
  /** Fontes do catálogo (categoria FONTE). */
  fontes: ProdutoKit[];
  margem?: number;
}

/** Calcula as três linhas do kit. Nada é gravado: é a prévia que a vendedora confirma ou ajusta. */
export function calcularKit(e: EntradaKit): ResultadoKit {
  const avisos: string[] = [];
  const fita = quantidadePorMetro(e.fita, e.metros, "fita", "comprimento_rolo", avisos);
  const perfil = e.perfil
    ? quantidadePorMetro(e.perfil, e.metros, "perfil", "comprimento", avisos)
    : null;
  const fonte = escolherFonte(e.fita, e.metros, e.fontes, e.margem);
  if (fonte.tipo === "escolher") avisos.push(fonte.motivo);
  if (fonte.tipo === "sugerida" && fonte.confirmarTensao)
    avisos.push("Confirmar a tensão (12 ou 24 V) da fita e da fonte: o catálogo não informa.");
  return { metros: e.metros, fita, perfil, fonte, avisos };
}
