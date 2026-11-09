import { describe, expect, it, vi } from "vitest";
import {
  ESQUEMA_JSON_ANALISE,
  ESQUEMA_JSON_SAIDA,
  MAX_ANALISE,
  MAX_MOTIVO,
  schemaSaidaIA,
} from "./esquema";
import { INSTRUCOES_LOJA } from "./instrucoes";
import { reescreverAnaliseAmbiente, type DepsMontar, type RepositorioIA } from "./montar";
import type { ClienteIA, RespostaIA } from "./motor";
import { normalizarSaida, type ProdutoCatalogo } from "./normalizar";
import { limparTexto, mencionaAnexo, removerReferenciasAAnexos } from "./texto-cliente";
import type { ConfigIA } from "./config";

const catalogo = new Map<string, ProdutoCatalogo>([
  [
    "9520",
    {
      codigo: "9520",
      descricao: "STELLA DIC 6W 2.7K",
      unidade: "un",
      preco_unitario: 37,
      ativo: true,
    },
  ],
]);

const saida = (
  extra: Record<string, unknown> = {},
  motivo = "Luz quente para deixar a sala acolhedora.",
) =>
  schemaSaidaIA.parse({
    ambientes: [
      {
        nome: "Sala",
        analise_ambiente:
          "Com base nas informações do pedido, a sala é um espaço de convivência. A luz quente deixa o ambiente acolhedor.",
        anexos_usados: [],
        itens: [
          {
            codigo: "9520",
            quantidade: 2,
            justificativa: "interna",
            motivo_cliente: motivo,
            descricao_avulso: null,
          },
        ],
        ...extra,
      },
    ],
    pendencias: [],
    resumo_para_vendedora: "",
  });

describe("esquema estrito para a API", () => {
  /** Em structured outputs strict, todo objeto tem additionalProperties false e todas as chaves em required. */
  function estrito(no: unknown, caminho = "raiz"): string[] {
    const erros: string[] = [];
    if (no && typeof no === "object") {
      const o = no as Record<string, unknown>;
      if (o.type === "object") {
        const props = Object.keys((o.properties as object) ?? {});
        if (o.additionalProperties !== false) erros.push(`${caminho}: additionalProperties`);
        if (
          JSON.stringify([...(o.required as string[])].sort()) !== JSON.stringify([...props].sort())
        )
          erros.push(`${caminho}: required`);
      }
      for (const [k, v] of Object.entries(o)) erros.push(...estrito(v, `${caminho}.${k}`));
    }
    return erros;
  }

  it("o esquema do orçamento e o da análise são estritos", () => {
    expect(estrito(ESQUEMA_JSON_SAIDA)).toEqual([]);
    expect(estrito(ESQUEMA_JSON_ANALISE)).toEqual([]);
  });

  it("pede análise por ambiente, anexos usados e motivo por item, sem campo de preço", () => {
    const amb = ESQUEMA_JSON_SAIDA.properties.ambientes.items.properties;
    expect(Object.keys(amb)).toEqual(["nome", "analise_ambiente", "anexos_usados", "itens"]);
    expect(Object.keys(amb.itens.items.properties)).toEqual([
      "codigo",
      "quantidade",
      "justificativa",
      "motivo_cliente",
      "descricao_avulso",
    ]);
    expect(JSON.stringify(ESQUEMA_JSON_SAIDA)).not.toMatch(/"preco/);
  });

  it("o zod aceita saída antiga sem os campos novos (valores padrão)", () => {
    const r = schemaSaidaIA.parse({
      ambientes: [
        {
          nome: "Sala",
          itens: [{ codigo: "9520", quantidade: 1, justificativa: "x", descricao_avulso: null }],
        },
      ],
    });
    expect(r.ambientes[0]).toMatchObject({ analise_ambiente: "", anexos_usados: [] });
    expect(r.ambientes[0].itens[0].motivo_cliente).toBe("");
  });
});

describe("instruções: regras dos textos para o cliente", () => {
  it("cobrem tom, termos técnicos, não inventar, preço/marca/dados e anexos", () => {
    for (const trecho of [
      "analise_ambiente",
      "motivo_cliente",
      "sem jargão",
      "explique em poucas palavras",
      "NUNCA invente",
      "Não cite preço",
      "Pela foto da sala",
      "Com base nas informações do pedido",
      "Uma foto que não ajuda",
      "anexos_usados",
    ]) {
      expect(INSTRUCOES_LOJA).toContain(trecho);
    }
  });
});

describe("normalizarSaida: análise e motivo", () => {
  it("grava a análise do ambiente e o motivo de cada item (o preço continua do catálogo)", () => {
    const r = normalizarSaida(saida(), catalogo, []);
    expect(r.ambientes).toEqual([
      expect.objectContaining({ nome: "Sala", ordem: 0, anexos_usados: [] }),
    ]);
    expect(r.ambientes[0].analise).toContain("Com base nas informações do pedido");
    expect(r.itens[0]).toMatchObject({
      motivo_cliente: "Luz quente para deixar a sala acolhedora.",
      preco_unitario_congelado: 37,
    });
  });

  it("corta o motivo no limite e a análise no limite", () => {
    const longo = "Frase muito longa de teste. ".repeat(40);
    const r = normalizarSaida(saida({ analise_ambiente: longo }, longo), catalogo, []);
    expect(r.itens[0].motivo_cliente.length).toBeLessThanOrEqual(MAX_MOTIVO + 1);
    expect(r.ambientes[0].analise.length).toBeLessThanOrEqual(MAX_ANALISE + 1);
  });

  it("só aceita ids de anexos que existem no orçamento", () => {
    const r = normalizarSaida(
      saida({
        analise_ambiente: "Pela foto da sala, o pé-direito parece médio.",
        anexos_usados: ["a1", "inventado"],
      }),
      catalogo,
      ["a1", "a2"],
    );
    expect(r.ambientes[0].anexos_usados).toEqual(["a1"]);
    expect(r.ambientes[0].analise).toContain("Pela foto da sala");
  });

  it("sem anexo usado, frases que citam foto ou planta saem e viram aviso", () => {
    const r = normalizarSaida(
      saida({
        analise_ambiente:
          "Pela foto da sala, o forro é de gesso. A sala é usada à noite. O pé-direito está na planta.",
      }),
      catalogo,
      ["a1"],
    );
    expect(r.ambientes[0].analise).toBe("A sala é usada à noite.");
    expect(r.avisos.join(" ")).toMatch(/removidas 2 frase/);
  });

  it("auxiliares de texto", () => {
    expect(limparTexto("  muitos   espaços  ", 50)).toBe("muitos espaços");
    expect(limparTexto("Um. Dois. Três. Quatro.", 15)).toBe("Um. Dois.");
    expect(mencionaAnexo("Pela FOTO da sala")).toBe(true);
    expect(mencionaAnexo("A sala é ampla.")).toBe(false);
    expect(removerReferenciasAAnexos("Sem foto aqui? Não. Só texto.").removidas).toBe(1);
  });
});

// ---------------------------------------------------------------- reescrever análise

const config: ConfigIA = {
  modelo: "teste",
  limiteDiario: 20,
  maxGeracoesPorOrcamento: 3,
  maxRodadasFerramentas: 8,
  precoEntradaUsdMtok: 4,
  precoSaidaUsdMtok: 20,
  raciocinio: null,
  timeoutChamadaMs: 1000,
};

const resposta = (obj: unknown): RespostaIA => ({
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }],
  usage: { input_tokens: 1000, output_tokens: 200 },
});

function montarCenario(opcoes: {
  usoDia?: number;
  itens?: number;
  ia: (() => Promise<RespostaIA>)[];
}) {
  const salvas: { ambiente: string; analise: string; usados: string[] }[] = [];
  const usos: { tipo?: string; fim?: { status: string } }[] = [];
  const repo = {
    async carregarOrcamento(id: string) {
      return {
        id,
        vendedora_id: "v1",
        status: "rascunho",
        respostas: {
          cliente_nome: "Maria",
          cliente_whatsapp: "+5582999991234",
          tipo_cliente: "final",
          tipo_obra: { uso: "residencial", estado: "reforma" },
          ambientes: ["sala"],
          pedido_cliente: "Spots na sala.",
          linha: "tecnica",
          prazo: "encomenda",
        },
      };
    },
    async contarUso() {
      return opcoes.usoDia ?? 0;
    },
    async iniciarUso(d: { tipo?: string }) {
      usos.push({ tipo: d.tipo });
      return String(usos.length);
    },
    async finalizarUso(id: string, d: { status: string }) {
      usos[Number(id) - 1].fim = d;
    },
    async carregarAnexos() {
      return [
        {
          id: "a1",
          tipo: "foto",
          nome: "sala.jpg",
          mime: "image/jpeg",
          dados: new Uint8Array([1, 2, 3]),
        },
      ];
    },
    async itensDoAmbiente() {
      return Array.from({ length: opcoes.itens ?? 1 }, () => ({
        codigo: "9520",
        descricao: "STELLA DIC 6W 2.7K",
        quantidade: 4,
      }));
    },
    async salvarAnalise(_o: string, ambiente: string, analise: string, usados: string[]) {
      salvas.push({ ambiente, analise, usados });
    },
  } as unknown as RepositorioIA;
  let i = 0;
  const create = vi.fn(async () => opcoes.ia[Math.min(i++, opcoes.ia.length - 1)]());
  const deps: DepsMontar = {
    repo,
    ia: { responses: { create } } as ClienteIA,
    executor: async () => ({}),
    config,
  };
  return { deps, salvas, usos, create };
}

describe("reescreverAnaliseAmbiente", () => {
  it("grava a análise nova (sem ferramentas, esquema próprio) e registra o uso como reescrita", async () => {
    const c = montarCenario({
      ia: [
        async () =>
          resposta({
            analise_ambiente: "Pela foto da sala, vemos um forro baixo. A luz quente ajuda.",
            anexos_usados: ["a1", "zzz"],
          }),
      ],
    });
    const r = await reescreverAnaliseAmbiente(c.deps, "v1", "o1", "Sala");
    expect(r).toMatchObject({ ok: true, anexosUsados: ["a1"] });
    expect(c.salvas).toEqual([
      {
        ambiente: "Sala",
        analise: "Pela foto da sala, vemos um forro baixo. A luz quente ajuda.",
        usados: ["a1"],
      },
    ]);
    expect(c.usos[0]).toMatchObject({ tipo: "reescrever_analise", fim: { status: "ok" } });

    const parametros = (c.create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(parametros.tools).toBeUndefined();
    expect(JSON.stringify(parametros.input)).toContain("Anexo id=a1");
    expect(JSON.stringify(parametros.input)).not.toMatch(/Maria|99999/);
  });

  it("sem anexo usado, tira as frases que citam foto", async () => {
    const c = montarCenario({
      ia: [
        async () =>
          resposta({
            analise_ambiente: "Pela foto, o forro é baixo. A sala é de convivência.",
            anexos_usados: [],
          }),
      ],
    });
    const r = await reescreverAnaliseAmbiente(c.deps, "v1", "o1", "Sala");
    expect(r).toMatchObject({ ok: true, analise: "A sala é de convivência." });
  });

  it("erro da API não grava nada; limite diário e ambiente vazio não chamam a API", async () => {
    const erro = montarCenario({
      ia: [async () => Promise.reject(Object.assign(new Error("429"), { status: 429 }))],
    });
    const r = await reescreverAnaliseAmbiente(erro.deps, "v1", "o1", "Sala");
    expect(r).toMatchObject({ ok: false, motivo: "ia", podeTentarDeNovo: true });
    expect(erro.salvas).toEqual([]);
    expect(erro.usos[0].fim?.status).toBe("erro");

    const limite = montarCenario({ usoDia: 20, ia: [async () => resposta({})] });
    expect(await reescreverAnaliseAmbiente(limite.deps, "v1", "o1", "Sala")).toMatchObject({
      ok: false,
      motivo: "limite_diario",
    });
    expect(limite.create).not.toHaveBeenCalled();

    const vazio = montarCenario({ itens: 0, ia: [async () => resposta({})] });
    expect(await reescreverAnaliseAmbiente(vazio.deps, "v1", "o1", "Sala")).toMatchObject({
      ok: false,
    });
    expect(vazio.create).not.toHaveBeenCalled();
  });

  it("resposta sem análise é recusada e nada é gravado", async () => {
    const c = montarCenario({
      ia: [async () => resposta({ analise_ambiente: "", anexos_usados: [] })],
    });
    expect(await reescreverAnaliseAmbiente(c.deps, "v1", "o1", "Sala")).toMatchObject({
      ok: false,
      motivo: "ia",
    });
    expect(c.salvas).toEqual([]);
  });
});
