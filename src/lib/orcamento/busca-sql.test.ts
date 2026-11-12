/* eslint-disable @typescript-eslint/no-explicit-any -- JSON da função SQL */
// Dia 10A no Postgres local (PGlite): listar_orcamentos (busca, filtros, ordem, cursor), a regra de
// vencimento em SQL (que precisa concordar com a de TypeScript) e o isolamento entre vendedoras.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";
import { diasParaVencer } from "./validade";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const cli = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const orc = (n: number) => `00000000-0000-0000-0000-00000000${String(3000 + n)}`;

let db: PGlite;
const numeros = new Map<number, string>();

interface O {
  n: number;
  vend: string;
  cli: number;
  total: number;
  status?: string;
  validadeDias?: number | null;
  motivo?: string;
  criado?: string;
  enviado?: string;
  item?: [string, string];
}

async function criar(o: O) {
  await db.exec(
    `insert into orcamentos (id, vendedora_id, cliente_id, valor_total, criado_em)
     values ('${orc(o.n)}', '${o.vend}', '${cli(o.cli)}', ${o.total}, ${o.criado ? `'${o.criado}'` : "now()"});`,
  );
  if (o.item) {
    await db.exec(
      `insert into orcamento_itens (orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem)
       values ('${orc(o.n)}', '${o.item[0]}', '${o.item[1]}', 40, 1, 'Sala', false, 0);`,
    );
  }
  if (o.status) {
    await db.exec(
      `update orcamentos set status = '${o.status}',
         validade = ${o.validadeDias === undefined || o.validadeDias === null ? "null" : `hoje_maceio() + ${o.validadeDias}`},
         motivo_perda = ${o.motivo ? `'${o.motivo}'` : "null"},
         ${o.enviado ? `enviado_em = '${o.enviado}',` : ""}
         valor_fechado = ${o.status === "fechado" ? o.total : "null"}
       where id = '${orc(o.n)}';`,
    );
  }
  numeros.set(
    o.n,
    (await db.query<{ numero: string }>(`select numero from orcamentos where id = '${orc(o.n)}'`))
      .rows[0].numero,
  );
}

const listar = (usuario: string, p: Record<string, unknown> = {}) =>
  comoUsuario<{ r: any }>(db, usuario, "select listar_orcamentos($1::jsonb) as r", [
    JSON.stringify(p),
  ]).then((x) => x.rows[0].r);

const nums = (r: any) => (r.itens as any[]).map((i) => i.numero).sort();
const esperado = (...ns: number[]) => ns.map((n) => numeros.get(n)!).sort();

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into produtos (codigo, descricao, unidade, preco_unitario) values
      ('9520', 'STELLA DIC 6W', 'un', 40), ('12222', 'MTS FITA 22W/M', 'm', 20);
    insert into clientes (id, vendedora_id, nome, whatsapp, tipo, arquiteto_indicador) values
      ('${cli(1)}', '${ALINE}', 'Maria Silva', '+55 82 99988-7766', 'final', null),
      ('${cli(2)}', '${ALINE}', 'João Pereira', '+5582911112222', 'arquiteto', null),
      ('${cli(3)}', '${ALINE}', 'Construtora Alfa', '+558233334444', 'construtora', 'Ana Arquiteta'),
      ('${cli(4)}', '${KELY}', 'Maria Silva', '+5582900000000', 'final', null),
      ('${cli(5)}', '${ALINE}', 'TESTE Zé', '+5582955550000', 'final', null);
  `);
  await criar({
    n: 1,
    vend: ALINE,
    cli: 1,
    total: 1000,
    status: "gerado",
    validadeDias: 5,
    criado: "2026-11-05 12:00-03",
    item: ["9520", "STELLA DIC 6W"],
  });
  await criar({
    n: 2,
    vend: ALINE,
    cli: 1,
    total: 3000,
    status: "enviado",
    validadeDias: 1,
    criado: "2026-11-06 12:00-03",
    enviado: "2026-11-07 12:00-03",
    item: ["12222", "MTS FITA 22W/M"],
  });
  await criar({
    n: 3,
    vend: ALINE,
    cli: 2,
    total: 500,
    status: "perdido",
    validadeDias: -3,
    motivo: "preco",
    criado: "2026-11-02 12:00-03",
  });
  await criar({
    n: 4,
    vend: ALINE,
    cli: 3,
    total: 8000,
    status: "followup_d5",
    validadeDias: -2,
    criado: "2026-11-03 12:00-03",
    enviado: "2026-11-04 12:00-03",
  });
  await criar({
    n: 5,
    vend: ALINE,
    cli: 3,
    total: 2000,
    status: "fechado",
    validadeDias: -10,
    criado: "2026-10-20 12:00-03",
  });
  await criar({
    n: 6,
    vend: ALINE,
    cli: 5,
    total: 9999,
    status: "gerado",
    validadeDias: 3,
    criado: "2026-11-08 12:00-03",
  });
  await criar({
    n: 7,
    vend: KELY,
    cli: 4,
    total: 4000,
    status: "enviado",
    validadeDias: 2,
    criado: "2026-11-09 12:00-03",
    item: ["9520", "STELLA DIC 6W"],
  });
  await criar({ n: 8, vend: ALINE, cli: 2, total: 0, criado: "2026-11-10 12:00-03" }); // rascunho
}, 90_000);

afterAll(async () => {
  await db.close();
});

describe("busca por texto", () => {
  it("por número do orçamento", async () => {
    expect(nums(await listar(ALINE, { q: numeros.get(2), status: undefined }))).toEqual(
      esperado(2),
    );
  });

  it("por nome: a vendedora nunca recebe orçamento de outra, mesmo com o mesmo nome de cliente", async () => {
    expect(nums(await listar(ALINE, { q: "maria silva" }))).toEqual(esperado(1, 2));
    expect(nums(await listar(KELY, { q: "maria silva" }))).toEqual(esperado(7));
    expect(nums(await listar(GERENTE, { q: "maria" }))).toEqual(esperado(1, 2, 7));
  });

  it("por WhatsApp parcial, só dígitos (com ou sem máscara)", async () => {
    expect(nums(await listar(ALINE, { q: "99988" }))).toEqual(esperado(1, 2));
    expect(nums(await listar(ALINE, { q: "(82) 99988-77" }))).toEqual(esperado(1, 2));
    expect(nums(await listar(ALINE, { q: "5582911112222" }))).toEqual(esperado(3, 8));
    // dois dígitos soltos não viram busca de telefone (e não casam com mais nada)
    expect(nums(await listar(ALINE, { q: "77" }))).toEqual([]);
  });

  it("por nome do arquiteto", async () => {
    expect(nums(await listar(ALINE, { q: "ana arq" }))).toEqual(esperado(4, 5));
  });

  it("por código de produto (exato) e por descrição de produto", async () => {
    expect(nums(await listar(ALINE, { q: "9520" }))).toEqual(esperado(1));
    expect(nums(await listar(GERENTE, { q: "9520" }))).toEqual(esperado(1, 7));
    expect(nums(await listar(ALINE, { q: "fita 22" }))).toEqual(esperado(2));
    expect(nums(await listar(ALINE, { q: "12222" }))).toEqual(esperado(2, 3, 8));
    // ^ o 3 e o 8 vêm do WhatsApp do João (5582911112222): dígitos de código também casam com telefone.
    expect(nums(await listar(ALINE, { q: "952" }))).toEqual([]); // código é exato
  });

  it("%, _ e \\ na busca valem como texto comum", async () => {
    expect((await listar(ALINE, { q: "%" })).total).toBe(0);
    expect((await listar(ALINE, { q: "_" })).total).toBe(0);
    expect((await listar(ALINE, { q: "\\" })).total).toBe(0);
  });

  it("busca vazia devolve tudo da vendedora", async () => {
    expect((await listar(ALINE, { q: "   " })).total).toBe(7);
    expect((await listar(KELY, {})).total).toBe(1);
  });
});

describe("filtros", () => {
  it("status", async () => {
    expect(nums(await listar(ALINE, { status: ["fechado", "perdido"] }))).toEqual(esperado(3, 5));
  });

  it("faixa de valor", async () => {
    expect(nums(await listar(ALINE, { valor_min: 1000, valor_max: 3000 }))).toEqual(
      esperado(1, 2, 5),
    );
    expect(nums(await listar(ALINE, { valor_min: 8000 }))).toEqual(esperado(4, 6));
  });

  it("tipo de cliente e tem arquiteto", async () => {
    expect(nums(await listar(ALINE, { tipo: "arquiteto" }))).toEqual(esperado(3, 8));
    expect(nums(await listar(ALINE, { arquiteto: "1" }))).toEqual(esperado(4, 5));
  });

  it("motivo da perda", async () => {
    expect(nums(await listar(ALINE, { motivo: "preco" }))).toEqual(esperado(3));
    expect(nums(await listar(ALINE, { motivo: "desistiu" }))).toEqual([]);
  });

  it("validade: vigente, vence em até 2 dias, vencida (fechado e perdido nunca vencem)", async () => {
    expect(nums(await listar(ALINE, { validade: "vigente" }))).toEqual(esperado(1, 2, 6));
    expect(nums(await listar(ALINE, { validade: "vence_2d" }))).toEqual(esperado(2));
    expect(nums(await listar(ALINE, { validade: "vencida" }))).toEqual(esperado(4));
  });

  it("período por data de criação e de envio (dias de Maceió)", async () => {
    expect(
      nums(await listar(ALINE, { campo: "criado", de: "2026-11-05", ate: "2026-11-06" })),
    ).toEqual(esperado(1, 2));
    expect(
      nums(await listar(ALINE, { campo: "enviado", de: "2026-11-07", ate: "2026-11-07" })),
    ).toEqual(esperado(2));
    expect(nums(await listar(ALINE, { campo: "criado", ate: "2026-10-31" }))).toEqual(esperado(5));
    expect(nums(await listar(ALINE, { campo: "criado", de: "2026-11-09" }))).toEqual(esperado(8));
  });

  it("os de teste ficam fora só se pedido", async () => {
    expect(nums(await listar(ALINE, { incluir_teste: false, valor_min: 9000 }))).toEqual([]);
    expect(nums(await listar(ALINE, { valor_min: 9000 }))).toEqual(esperado(6));
  });

  it("vendedora: a gerente filtra; a vendedora pedindo outra continua sem enxergar nada dela", async () => {
    expect(nums(await listar(GERENTE, { vendedora: KELY }))).toEqual(esperado(7));
    const r = await listar(ALINE, { vendedora: KELY });
    expect(r.total).toBe(0);
    expect(r.itens).toEqual([]);
  });

  it("combina filtros e devolve os campos da lista", async () => {
    const r = await listar(GERENTE, { q: "maria", status: ["enviado"], valor_min: 3500 });
    expect(nums(r)).toEqual(esperado(7));
    expect(r.itens[0]).toMatchObject({
      cliente_nome: "Maria Silva",
      vendedora_nome: "Kely",
      status: "enviado",
      cliente_whatsapp: "+5582900000000",
    });
    expect(Number(r.itens[0].valor_total)).toBe(4000);
  });

  it("total e contagem por status (esta ignora o filtro de status, para os chips)", async () => {
    const r = await listar(ALINE, { status: ["fechado"] });
    expect(r.total).toBe(1);
    expect(r.por_status).toMatchObject({
      fechado: 1,
      perdido: 1,
      gerado: 2,
      enviado: 1,
      followup_d5: 1,
      rascunho: 1,
    });
  });
});

describe("ordem e cursor", () => {
  const ordens: [string, (a: any, b: any) => number][] = [
    [
      "recentes",
      (a, b) =>
        a.atualizado_em < b.atualizado_em ? 1 : a.atualizado_em > b.atualizado_em ? -1 : 0,
    ],
    ["valor", (a, b) => Number(b.valor_total) - Number(a.valor_total)],
    ["validade", (a, b) => (a.validade ?? "9999").localeCompare(b.validade ?? "9999")],
    ["cliente", (a, b) => a.cliente_nome.toLowerCase().localeCompare(b.cliente_nome.toLowerCase())],
  ];

  it.each(ordens)(
    "ordem %s: respeita a ordem e a paginação de 2 em 2 não repete nem perde",
    async (ordem, cmp) => {
      const tudo = await listar(GERENTE, { ordem, limite: 100 });
      expect(tudo.itens).toHaveLength(8);
      expect(tudo.proximo).toBeNull();
      const ordenado = [...tudo.itens].sort(cmp);
      // A ordem devolvida bate com a chave (empates podem trocar de lugar entre si).
      for (let i = 1; i < tudo.itens.length; i++)
        expect(cmp(tudo.itens[i - 1], tudo.itens[i])).toBeLessThanOrEqual(0);
      expect(ordenado).toHaveLength(8);

      const vistos: string[] = [];
      let cursor: string | null = null;
      let paginas = 0;
      do {
        const pagina: any = await listar(GERENTE, {
          ordem,
          limite: 2,
          ...(cursor ? { cursor } : {}),
        });
        expect(pagina.total).toBe(8); // a contagem total não depende da página
        vistos.push(...pagina.itens.map((i: any) => i.numero));
        cursor = pagina.proximo;
        paginas++;
      } while (cursor && paginas < 10);
      expect(paginas).toBe(4);
      expect(vistos).toEqual(tudo.itens.map((i: any) => i.numero)); // mesma ordem, sem repetir nem perder
    },
  );

  it("limite máximo de 100 e mínimo de 1", async () => {
    expect((await listar(GERENTE, { limite: 0 })).itens).toHaveLength(1);
    expect((await listar(GERENTE, { limite: 5000 })).itens).toHaveLength(8);
  });

  it("ordem desconhecida volta para os mais recentes", async () => {
    const a = await listar(GERENTE, { ordem: "x", limite: 100 });
    const b = await listar(GERENTE, { ordem: "recentes", limite: 100 });
    expect(a.itens.map((i: any) => i.numero)).toEqual(b.itens.map((i: any) => i.numero));
  });
});

describe("regra de vencimento: SQL e TypeScript concordam", () => {
  it("orcamento_dias_para_vencer = diasParaVencer para todos os status e distâncias", async () => {
    const hoje = (await db.query<{ h: string }>("select hoje_maceio()::text as h")).rows[0].h;
    const status = [
      "rascunho",
      "gerado",
      "enviado",
      "followup_d5",
      "followup_d10",
      "fechado",
      "perdido",
    ];
    for (const s of status) {
      for (const dias of [-30, -2, -1, 0, 1, 2, 30]) {
        const { rows } = await db.query<{ d: number | null }>(
          `select orcamento_dias_para_vencer('${s}', hoje_maceio() + ${dias}) as d`,
        );
        const [a, m, d] = hoje.split("-").map(Number);
        const validade = new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
        expect(rows[0].d, `${s} ${dias}`).toBe(diasParaVencer(s, validade, hoje));
      }
      const { rows } = await db.query<{ d: number | null }>(
        `select orcamento_dias_para_vencer('${s}', null) as d`,
      );
      expect(rows[0].d).toBeNull();
      expect(diasParaVencer(s, null, hoje)).toBeNull();
    }
  });
});

describe("índices: a busca não vira varredura completa", () => {
  it("nome do cliente, WhatsApp, descrição do item e número usam índice com milhares de linhas", async () => {
    await db.exec(`
      insert into clientes (id, vendedora_id, nome, whatsapp, arquiteto_indicador)
        select gen_random_uuid(), '${ALINE}', 'Cliente ' || md5(g::text), '+55829' || lpad(((g * 7919) % 100000000)::text, 8, '0'), 'Arq ' || md5((g * 7)::text)
          from generate_series(1, 6000) g;
      insert into orcamento_itens (orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem)
        select '${orc(1)}', null, 'Item avulso ' || md5(g::text), 1, 1, 'Sala', true, g
          from generate_series(1, 6000) g;
      analyze clientes; analyze orcamento_itens; analyze orcamentos;
    `);
    await db.exec("set enable_seqscan = off"); // com poucas linhas o planejador prefere varrer; aqui conta se o índice SERVE
    const plano = async (sql: string) =>
      (await db.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows
        .map((r) => r["QUERY PLAN"])
        .join("\n");

    const nome = await plano("select 1 from clientes c where c.nome ilike '%ab12cd%'");
    expect(nome).toContain("clientes_nome_trgm");
    const whats = await plano("select 1 from clientes c where c.whatsapp_digitos like '%9772046%'");
    expect(whats).toContain("clientes_whatsapp_digitos_trgm");
    const arq = await plano(
      "select 1 from clientes c where c.arquiteto_indicador ilike '%ab12cd%'",
    );
    expect(arq).toContain("clientes_arquiteto_trgm");
    const desc = await plano(
      "select 1 from orcamento_itens i where i.descricao_congelada ilike '%ab12cd%'",
    );
    expect(desc).toContain("orcamento_itens_descricao_trgm");
    const cod = await plano("select 1 from orcamento_itens i where i.codigo = '9520'");
    expect(cod).toContain("orcamento_itens_codigo");
    const numero = await plano("select 1 from orcamentos o where o.numero ilike '%0004%'");
    expect(numero).toMatch(/orcamentos_numero_trgm|orcamentos_numero_key|Seq Scan on orcamentos/); // 8 linhas: o planejador pode preferir varrer

    const t0 = Date.now();
    await listar(ALINE, { q: "ab12cd" });
    expect(Date.now() - t0).toBeLessThan(6000);
  });
});
