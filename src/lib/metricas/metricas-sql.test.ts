/* eslint-disable @typescript-eslint/no-explicit-any -- JSON vindo do banco (funções SQL), normalizado logo abaixo */
// Dia 9A no Postgres local (PGlite): metricas_orcamentos, serie_semanal_orcamentos e custo_ia_orcamentos
// com um conjunto pequeno montado à mão, em que o resultado de cada métrica é conhecido.
// Período: novembro de 2026 (01/11 a 30/11), em dias de Maceió. Ver docs/metricas.md.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const CLI_A = "00000000-0000-0000-0000-0000000000c1";
const CLI_K = "00000000-0000-0000-0000-0000000000c2";
const CLI_T = "00000000-0000-0000-0000-0000000000c3";
const id = (n: number) => `00000000-0000-0000-0000-00000000${String(2000 + n)}`;

let db: PGlite;

interface Orc {
  n: number;
  vend: string;
  cli: string;
  total: number;
  criado: string;
  gerado?: string;
  enviado?: string;
  fechado?: string;
  perdido?: string;
  status?: string;
  valorFechado?: number;
  motivo?: string;
  respostas?: string;
}

const ts = (d?: string) => (d ? `'${d}'::timestamptz` : "null");

/** Insere como rascunho (para poder pôr itens) e depois grava status e datas de uma vez. */
async function orc(o: Orc) {
  await db.exec(`
    insert into orcamentos (id, vendedora_id, cliente_id, respostas, valor_total, criado_em)
      values ('${id(o.n)}', '${o.vend}', '${o.cli}', '${o.respostas ?? "{}"}', ${o.total}, ${ts(o.criado)});
  `);
}
async function etapas(o: Orc) {
  if (!o.status) return;
  await db.exec(`
    update orcamentos set status = '${o.status}',
      gerado_em = ${ts(o.gerado)}, enviado_em = ${ts(o.enviado)}, ultimo_envio_em = ${ts(o.enviado)},
      fechado_em = ${ts(o.fechado)}, perdido_em = ${ts(o.perdido)},
      valor_fechado = ${o.valorFechado ?? "null"}, motivo_perda = ${o.motivo ? `'${o.motivo}'` : "null"}
     where id = '${id(o.n)}';
  `);
}

const M = (
  usuario: string,
  inicio = "2026-11-01",
  fim = "2026-11-30",
  vend: string | null = null,
) =>
  comoUsuario<{ r: Record<string, any> }>(
    db,
    usuario,
    "select metricas_orcamentos($1::date, $2::date, $3::uuid) as r",
    [inicio, fim, vend],
  ).then((x) => x.rows[0].r);

const porNome = (r: Record<string, any>, nome: string) =>
  r.vendedoras.find((v: any) => v.nome === nome);

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into produtos (codigo, descricao, unidade, preco_unitario) values ('9520', 'STELLA', 'un', 40);
    insert into clientes (id, vendedora_id, nome) values
      ('${CLI_A}', '${ALINE}', 'Cliente Real A'),
      ('${CLI_K}', '${KELY}', 'Cliente Real K'),
      ('${CLI_T}', '${ALINE}', 'TESTE Fulano');
  `);

  const d = (dia: string) => `2026-${dia} 12:00:00-03`;
  const A = ALINE;
  const lista: Orc[] = [
    // A1: fechou em 4 dias (valor fechado menor que o total)
    {
      n: 1,
      vend: A,
      cli: CLI_A,
      total: 1000,
      criado: d("11-05"),
      gerado: d("11-05"),
      enviado: d("11-06"),
      fechado: d("11-10"),
      status: "fechado",
      valorFechado: 900,
    },
    // A2: perdido por preço
    {
      n: 2,
      vend: A,
      cli: CLI_A,
      total: 2000,
      criado: d("11-03"),
      gerado: d("11-03"),
      enviado: d("11-04"),
      perdido: d("11-12"),
      status: "perdido",
      motivo: "preco",
    },
    // A3: em andamento (follow-up D+5)
    {
      n: 3,
      vend: A,
      cli: CLI_A,
      total: 500,
      criado: d("11-07"),
      gerado: d("11-07"),
      enviado: d("11-08"),
      status: "followup_d5",
    },
    // A4: rascunho (só conta como criado)
    { n: 4, vend: A, cli: CLI_A, total: 0, criado: d("11-09") },
    // A5: enviado em outubro, fechou em novembro (vendido em novembro; fora da safra de novembro)
    {
      n: 5,
      vend: A,
      cli: CLI_A,
      total: 3000,
      criado: d("10-28"),
      gerado: d("10-28"),
      enviado: d("10-29"),
      fechado: d("11-02"),
      status: "fechado",
      valorFechado: 3000,
    },
    // A6: enviado
    {
      n: 6,
      vend: A,
      cli: CLI_A,
      total: 700,
      criado: d("11-02"),
      gerado: d("11-02"),
      enviado: d("11-03"),
      status: "enviado",
    },
    // A7: perdido por prazo
    {
      n: 7,
      vend: A,
      cli: CLI_A,
      total: 400,
      criado: d("11-17"),
      gerado: d("11-17"),
      enviado: d("11-18"),
      perdido: d("11-20"),
      status: "perdido",
      motivo: "prazo_pronta_entrega",
    },
    // A8: cliente TESTE (fora)
    {
      n: 8,
      vend: A,
      cli: CLI_T,
      total: 9999,
      criado: d("11-05"),
      gerado: d("11-05"),
      enviado: d("11-05"),
      fechado: d("11-06"),
      status: "fechado",
      valorFechado: 9999,
    },
    // A9: respostas.teste = true (fora)
    {
      n: 9,
      vend: A,
      cli: CLI_A,
      total: 8888,
      criado: d("11-05"),
      gerado: d("11-05"),
      enviado: d("11-05"),
      perdido: d("11-06"),
      status: "perdido",
      motivo: "preco",
      respostas: '{"teste": true}',
    },
    // A10: fechou às 23h30 de 30/11 em Maceió (01/12 02:30 UTC): ainda é novembro
    {
      n: 10,
      vend: A,
      cli: CLI_A,
      total: 600,
      criado: d("11-24"),
      gerado: d("11-24"),
      enviado: d("11-25"),
      fechado: "2026-12-01 02:30:00+00",
      status: "fechado",
      valorFechado: 600,
    },
    // A11: fechou às 23h30 de 31/10 em Maceió (01/11 02:30 UTC): ainda é outubro
    {
      n: 11,
      vend: A,
      cli: CLI_A,
      total: 777,
      criado: d("10-20"),
      gerado: d("10-20"),
      enviado: d("10-28"),
      fechado: "2026-11-01 02:30:00+00",
      status: "fechado",
      valorFechado: 777,
    },
    // A12: enviado e depois fechado e reaberto pelas funções (criado/gerado/enviado em novembro)
    {
      n: 12,
      vend: A,
      cli: CLI_A,
      total: 800,
      criado: d("11-06"),
      gerado: d("11-06"),
      enviado: d("11-07"),
      status: "enviado",
    },
    // Kely
    {
      n: 21,
      vend: KELY,
      cli: CLI_K,
      total: 2000,
      criado: d("11-10"),
      gerado: d("11-10"),
      enviado: d("11-11"),
      fechado: d("11-15"),
      status: "fechado",
      valorFechado: 1800,
    },
    {
      n: 22,
      vend: KELY,
      cli: CLI_K,
      total: 1000,
      criado: d("11-12"),
      gerado: d("11-12"),
      enviado: d("11-13"),
      perdido: d("11-20"),
      status: "perdido",
      motivo: "comprou_em_outra_loja",
    },
    {
      n: 23,
      vend: KELY,
      cli: CLI_K,
      total: 300,
      criado: d("11-13"),
      gerado: d("11-13"),
      enviado: d("11-14"),
      perdido: d("11-21"),
      status: "perdido",
      motivo: "preco",
    },
  ];
  for (const o of lista) await orc(o);

  // Itens dos gerados em novembro (antes de sair de rascunho, por causa do bloqueio de edição).
  const item = (n: number, origem: string) =>
    `insert into orcamento_itens (orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem, origem)
     values ('${id(n)}', '9520', 'X', 40, 1, 'Sala', false, 0, '${origem}');`;
  await db.exec(
    [
      item(1, "manual"),
      item(1, "indicacao_ia"),
      item(1, "lista_colada"),
      item(2, "indicacao_ia"),
      item(2, "indicacao_ia"),
      item(3, "manual"),
      item(6, "manual"),
    ].join("\n"),
  );
  for (const o of lista) await etapas(o);

  // Indicações pedidas: 2 em novembro (Aline), 1 à meia-noite de 01/12 em Maceió (fora), 1 em orçamento de teste (fora).
  const ind = (n: number, v: string, quando: string) =>
    `insert into indicacoes_ia (orcamento_id, vendedora_id, ambiente, resposta, criado_em)
     values ('${id(n)}', '${v}', 'Sala', '{}'::jsonb, '${quando}');`;
  await db.exec(
    [
      ind(1, ALINE, "2026-11-05 12:00:00-03"),
      ind(1, ALINE, "2026-11-06 12:00:00-03"),
      ind(1, ALINE, "2026-12-01 03:00:00+00"),
      ind(8, ALINE, "2026-11-05 12:00:00-03"),
    ].join("\n"),
  );

  // Reaberto: fecha e volta para enviado pelas funções (como a vendedora faria).
  await comoUsuario(db, ALINE, "select mudar_status_orcamento($1, 'fechado', 800)", [id(12)]);
  await comoUsuario(db, ALINE, "select mudar_status_orcamento($1, 'enviado')", [id(12)]);

  // Uso de IA (custo): conta só status ok, fora de teste e no período.
  const uso = (n: number | null, tipo: string, custo: number, status: string, quando: string) =>
    `insert into uso_ia (orcamento_id, vendedora_id, tipo, custo_estimado, status, criado_em)
     values (${n === null ? "null" : `'${id(n)}'`}, '${ALINE}', '${tipo}', ${custo}, '${status}', '${quando}');`;
  await db.exec(
    [
      uso(1, "indicacao", 0.1, "ok", "2026-11-05 12:00:00-03"),
      uso(1, "formatacao", 0.02, "ok", "2026-11-05 12:01:00-03"),
      uso(8, "indicacao", 0.5, "ok", "2026-11-05 12:00:00-03"), // orçamento de teste
      uso(null, "indicacao", 0.03, "ok", "2026-11-09 12:00:00-03"), // orçamento apagado
      uso(1, "indicacao", 0.9, "erro", "2026-11-05 12:00:00-03"), // erro
      uso(1, "indicacao", 0.7, "ok", "2026-12-01 03:00:00+00"), // 01/12 em Maceió
    ].join("\n"),
  );
}, 90_000);

afterAll(async () => {
  await db.close();
});

describe("metricas_orcamentos: Aline (gerente vê igual; teste e outubro ficam de fora)", () => {
  it("contagens de etapa", async () => {
    const r = await M(GERENTE);
    const a = porNome(r, "Aline");
    expect(a.criados).toBe(8); // A1 A2 A3 A4 A6 A7 A10 A12 (A5 e A11 são de outubro; A8 e A9 são teste)
    expect(a.gerados).toBe(7); // todos menos A4
    expect(a.enviados).toBe(7); // A1 A2 A3 A6 A7 A10 A12
    expect(a.fechados).toBe(3); // A1, A5, A10 (A11 foi 31/10 em Maceió; A12 foi reaberto)
    expect(Number(a.valor_vendido)).toBe(4500); // 900 + 3000 + 600
    expect(a.perdidos).toBe(2);
    expect(Number(a.valor_perdido)).toBe(2400);
  });

  it("perdido por motivo", async () => {
    const a = porNome(await M(GERENTE), "Aline");
    expect(a.perdas).toEqual([
      { motivo: "preco", quantidade: 1, valor: 2000 },
      { motivo: "prazo_pronta_entrega", quantidade: 1, valor: 400 },
    ]);
  });

  it("safra: conversão em quantidade e em valor, com os em andamento", async () => {
    const a = porNome(await M(GERENTE), "Aline");
    expect(a.safra).toMatchObject({
      enviados: 7,
      fechados: 2, // A1 e A10
      perdidos: 2, // A2 e A7
      em_andamento: 3, // A3, A6 e A12 (reaberto)
    });
    expect(Number(a.conversao_qtd)).toBe(0.5);
    // fechado: 900 + 600 = 1500; resolvidos (valor_total): 1000 + 2000 + 400 + 600 = 4000
    expect(Number(a.conversao_valor)).toBe(0.375);
  });

  it("em aberto, ticket médio e mediana de dias", async () => {
    const a = porNome(await M(GERENTE), "Aline");
    expect(a.em_aberto_qtd).toBe(3); // A3, A6, A12
    expect(Number(a.em_aberto_valor)).toBe(2000); // 500 + 700 + 800
    expect(Number(a.ticket_medio)).toBe(1500);
    expect(Number(a.mediana_dias)).toBe(4); // A1: 4 dias, A5: 4 dias, A10: 5 dias
  });

  it("reaberto não conta como fechado nem como perdido", async () => {
    const { rows } = await db.query<{ status: string; fechado_em: string | null }>(
      `select status, fechado_em::text from orcamentos where id = '${id(12)}'`,
    );
    expect(rows[0]).toEqual({ status: "enviado", fechado_em: null });
  });

  it("uso da Indicação: pedidas no período e % dos itens dos gerados", async () => {
    const a = porNome(await M(GERENTE), "Aline");
    expect(a.indicacoes_pedidas).toBe(2); // 01/12 00:00 em Maceió e o de teste ficam fora
    expect(a.itens_total).toBe(7);
    expect(a.itens_indicacao_ia).toBe(3);
    expect(a.itens_lista_colada).toBe(1);
  });
});

describe("metricas_orcamentos: Kely e total", () => {
  it("Kely", async () => {
    const k = porNome(await M(GERENTE), "Kely");
    expect(k).toMatchObject({ criados: 3, gerados: 3, enviados: 3, fechados: 1, perdidos: 2 });
    expect(Number(k.valor_vendido)).toBe(1800);
    expect(Number(k.valor_perdido)).toBe(1300);
    expect(Number(k.conversao_qtd)).toBeCloseTo(1 / 3, 4);
    expect(Number(k.conversao_valor)).toBeCloseTo(1800 / 3300, 4);
    expect(k.em_aberto_qtd).toBe(0);
    expect(Number(k.ticket_medio)).toBe(1800);
    expect(Number(k.mediana_dias)).toBe(4);
    expect(k.perdas).toHaveLength(2);
    expect(k.indicacoes_pedidas).toBe(0);
  });

  it("total soma as duas (e a mediana vem de todos os fechados)", async () => {
    const t = (await M(GERENTE)).total;
    expect(t).toMatchObject({ criados: 11, gerados: 10, enviados: 10, fechados: 4, perdidos: 4 });
    expect(Number(t.valor_vendido)).toBe(6300);
    expect(Number(t.valor_perdido)).toBe(3700);
    expect(t.safra).toMatchObject({ fechados: 3, perdidos: 4, em_andamento: 3 });
    expect(Number(t.conversao_qtd)).toBeCloseTo(3 / 7, 4);
    expect(Number(t.conversao_valor)).toBeCloseTo(3300 / 7300, 4);
    expect(t.em_aberto_qtd).toBe(3);
    expect(Number(t.ticket_medio)).toBe(1575);
    expect(Number(t.mediana_dias)).toBe(4);
    expect(t.perdas).toEqual([
      { motivo: "preco", quantidade: 2, valor: 2300 },
      { motivo: "comprou_em_outra_loja", quantidade: 1, valor: 1000 },
      { motivo: "prazo_pronta_entrega", quantidade: 1, valor: 400 },
    ]);
  });
});

describe("metricas_orcamentos: período e virada de mês em Maceió", () => {
  it("dezembro: pega só o que passou da meia-noite de Maceió", async () => {
    const a = porNome(await M(GERENTE, "2026-12-01", "2026-12-31"), "Aline");
    expect(a.fechados).toBe(0); // A10 (23h30 de 30/11 em Maceió) não é dezembro
    expect(a.indicacoes_pedidas).toBe(1); // 00:00 de 01/12 em Maceió
    // E o em aberto não depende do período.
    expect(a.em_aberto_qtd).toBe(3);
  });

  it("outubro: A11 fechou 23h30 de 31/10 em Maceió", async () => {
    const a = porNome(await M(GERENTE, "2026-10-01", "2026-10-31"), "Aline");
    expect(a.fechados).toBe(1);
    expect(Number(a.valor_vendido)).toBe(777);
  });

  it("período invertido dá erro", async () => {
    await expect(M(GERENTE, "2026-11-30", "2026-11-01")).rejects.toThrow("PERIODO_INVALIDO");
  });

  it("período sem dados: tudo zero e conversão nula", async () => {
    const a = porNome(await M(GERENTE, "2025-01-01", "2025-01-31"), "Aline");
    expect(a).toMatchObject({ criados: 0, enviados: 0, fechados: 0, perdidos: 0 });
    expect(a.conversao_qtd).toBeNull();
    expect(a.ticket_medio).toBeNull();
    expect(a.mediana_dias).toBeNull();
  });
});

describe("isolamento dos números (RLS)", () => {
  it("Aline recebe só a linha dela e o total é só dela", async () => {
    const r = await M(ALINE);
    expect(r.vendedoras.map((v: any) => v.nome)).toEqual(["Aline"]);
    expect(r.total.enviados).toBe(7);
    expect(Number(r.total.valor_vendido)).toBe(4500);
  });

  it("Aline pedindo o id da Kely não recebe nada da Kely", async () => {
    const r = await M(ALINE, "2026-11-01", "2026-11-30", KELY);
    expect(r.vendedoras).toEqual([]);
    expect(r.total).toMatchObject({ criados: 0, enviados: 0, fechados: 0, perdidos: 0 });
    expect(Number(r.total.valor_vendido)).toBe(0);
  });

  it("Kely não vê nada da Aline", async () => {
    const r = await M(KELY, "2026-11-01", "2026-11-30", ALINE);
    expect(r.vendedoras).toEqual([]);
    expect(r.total.enviados).toBe(0);
  });

  it("a gerente filtra por uma vendedora", async () => {
    const r = await M(GERENTE, "2026-11-01", "2026-11-30", KELY);
    expect(r.vendedoras.map((v: any) => v.nome)).toEqual(["Kely"]);
    expect(r.total.fechados).toBe(1);
  });

  it("a view orcamentos_reais esconde os de teste e respeita a RLS", async () => {
    const a = await comoUsuario<{ n: string }>(
      db,
      ALINE,
      "select count(*)::text as n from orcamentos_reais",
    );
    expect(a.rows[0].n).toBe("10"); // 12 dela - 2 de teste
    const g = await comoUsuario<{ n: string }>(
      db,
      GERENTE,
      "select count(*)::text as n from orcamentos_reais",
    );
    expect(g.rows[0].n).toBe("13"); // 15 - 2 de teste
  });
});

describe("regra de teste (orcamento_eh_teste)", () => {
  it("reconhece o seed, o RLS e o cliente TESTE, mas não nomes parecidos", async () => {
    await db.exec(`
      insert into clientes (id, vendedora_id, nome) values
        ('00000000-0000-0000-0000-0000000000d1', '${ALINE}', 'teste e2e 123'),
        ('00000000-0000-0000-0000-0000000000d2', '${ALINE}', 'Testelli Iluminação'),
        ('00000000-0000-0000-0000-0000000000d3', '${ALINE}', 'Maria Teste');
    `);
    const q = async (resp: string, cli: string) =>
      (await db.query<{ t: boolean }>(`select orcamento_eh_teste('${resp}'::jsonb, '${cli}') as t`))
        .rows[0].t;
    expect(await q('{"teste": true}', CLI_A)).toBe(true);
    expect(await q('{"teste_rls": "true"}', CLI_A)).toBe(true);
    expect(await q("{}", "00000000-0000-0000-0000-0000000000d1")).toBe(true);
    expect(await q("{}", "00000000-0000-0000-0000-0000000000d2")).toBe(false);
    expect(await q("{}", "00000000-0000-0000-0000-0000000000d3")).toBe(false);
    expect(await q('{"teste": false}', CLI_A)).toBe(false);
  });
});

describe("serie_semanal_orcamentos", () => {
  it("13 semanas por vendedora, de segunda a domingo em Maceió", async () => {
    const { rows } = await comoUsuario<{ r: any[] }>(
      db,
      GERENTE,
      "select serie_semanal_orcamentos($1::date) as r",
      ["2026-11-30"],
    );
    const s = rows[0].r;
    expect(s).toHaveLength(26); // 13 semanas x 2 vendedoras
    expect(s[0].semana).toBe("2026-09-07");
    expect(s[s.length - 1].semana).toBe("2026-11-30");
    const linha = (semana: string, nome: string) =>
      s.find((x: any) => x.semana === semana && x.nome === nome);
    // Semana de 02/11: enviados A6 (03), A2 (04), A1 (06), A3 (08, domingo); fechado A5 (02).
    expect(linha("2026-11-02", "Aline")).toMatchObject({ enviados: 5, fechados: 1 }); // + A12 enviado 07/11
    expect(Number(linha("2026-11-02", "Aline").valor_vendido)).toBe(3000);
    // Semana de 09/11: A1 fechou em 10/11.
    expect(Number(linha("2026-11-09", "Aline").valor_vendido)).toBe(900);
    // A10 fechou 23h30 de 30/11 em Maceió: cai na semana de 30/11, não em dezembro.
    expect(linha("2026-11-30", "Aline")).toMatchObject({ fechados: 1 });
    expect(Number(linha("2026-11-30", "Aline").valor_vendido)).toBe(600);
    // Semana sem nada vem zerada.
    expect(linha("2026-09-07", "Kely")).toMatchObject({ enviados: 0, fechados: 0 });
  });

  it("a vendedora só vê a própria série", async () => {
    const { rows } = await comoUsuario<{ r: any[] }>(
      db,
      ALINE,
      "select serie_semanal_orcamentos($1::date, $2::uuid) as r",
      ["2026-11-30", KELY],
    );
    expect(rows[0].r).toEqual([]);
  });
});

describe("custo_ia_orcamentos (só a gerente)", () => {
  it("a gerente recebe o custo do período, sem teste, sem erro e com o apagado", async () => {
    const { rows } = await comoUsuario<{ r: any }>(
      db,
      GERENTE,
      "select custo_ia_orcamentos($1::date, $2::date) as r",
      ["2026-11-01", "2026-11-30"],
    );
    const r = rows[0].r;
    expect(Number(r.usd_total)).toBeCloseTo(0.15, 4); // 0.10 + 0.02 + 0.03
    expect(r.chamadas).toBe(3);
    expect(r.gerados).toBe(10);
    expect(r.por_tipo.map((t: any) => t.tipo).sort()).toEqual(["formatacao", "indicacao"]);
  });

  it("a vendedora não executa a função", async () => {
    await expect(
      comoUsuario(db, ALINE, "select custo_ia_orcamentos($1::date, $2::date)", [
        "2026-11-01",
        "2026-11-30",
      ]),
    ).rejects.toThrow("SEM_PERMISSAO");
  });
});

describe("câmbio", () => {
  it("padrão 5,50; a vendedora lê mas não altera", async () => {
    const lido = await comoUsuario<{ c: string }>(
      db,
      ALINE,
      "select cambio_usd_brl::text as c from configuracoes_loja",
    );
    expect(Number(lido.rows[0].c)).toBe(5.5);
    const alterado = await comoUsuario(
      db,
      ALINE,
      "update configuracoes_loja set cambio_usd_brl = 9 returning id",
    );
    expect(alterado.rows).toHaveLength(0);
    await expect(db.exec("update configuracoes_loja set cambio_usd_brl = 0")).rejects.toThrow();
  });
});
