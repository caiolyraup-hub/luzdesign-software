/* eslint-disable @typescript-eslint/no-explicit-any -- JSON das funções SQL */
// Dia 11B no Postgres local (PGlite): cadastro, RLS, números por vendedora, fusão e normalização.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";
import { normalizarNomeArquiteto } from "./aniversario";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const ARQ_LULA = "00000000-0000-0000-0000-0000000000a1";
const ARQ_LULA2 = "00000000-0000-0000-0000-0000000000a2";
const ARQ_INATIVO = "00000000-0000-0000-0000-0000000000a3";
const cli = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const orc = (n: number) => `00000000-0000-0000-0000-00000000${String(5000 + n)}`;

let db: PGlite;

const listar = (usuario: string, p: Record<string, unknown> = {}) =>
  comoUsuario<{ r: any[] }>(db, usuario, "select listar_arquitetos($1::jsonb) as r", [
    JSON.stringify(p),
  ]).then((x) => x.rows[0].r);

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into arquitetos (id, nome, escritorio, aniversario_dia, aniversario_mes, criado_por) values
      ('${ARQ_LULA}', 'Lula Santana', 'Santana Arquitetura', 29, 2, '${GERENTE}'),
      ('${ARQ_LULA2}', 'Lula  Santana ', null, null, null, '${ALINE}');
    insert into arquitetos (id, nome, ativo, criado_por) values ('${ARQ_INATIVO}', 'Antigo Inativo', false, '${GERENTE}');
    insert into clientes (id, vendedora_id, nome, whatsapp, arquiteto_id) values
      ('${cli(1)}', '${ALINE}', 'Maria Silva', '+5582999887766', '${ARQ_LULA}'),
      ('${cli(2)}', '${KELY}', 'Maria Silva', '+5582900000000', '${ARQ_LULA}'),
      ('${cli(3)}', '${ALINE}', 'João Pereira', '+5582911112222', '${ARQ_LULA2}');
    insert into orcamentos (id, vendedora_id, cliente_id, arquiteto_id, valor_total, status, criado_em) values
      ('${orc(1)}', '${ALINE}', '${cli(1)}', '${ARQ_LULA}', 1000, 'enviado', '2026-11-01 12:00-03'),
      ('${orc(2)}', '${ALINE}', '${cli(1)}', '${ARQ_LULA}', 2000, 'enviado', '2026-11-05 12:00-03'),
      ('${orc(3)}', '${KELY}', '${cli(2)}', '${ARQ_LULA}', 9000, 'enviado', '2026-11-02 12:00-03'),
      ('${orc(4)}', '${ALINE}', '${cli(3)}', '${ARQ_LULA2}', 300, 'enviado', '2026-11-08 12:00-03');
    update orcamentos set status = 'fechado', valor_fechado = 1800, fechado_em = now() where id = '${orc(1)}';
    update orcamentos set status = 'fechado', valor_fechado = 8500, fechado_em = now() where id = '${orc(3)}';
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("normalização de nomes", () => {
  it("o SQL e o TypeScript geram a mesma chave", async () => {
    for (const nome of [
      "  Lula   Santana ",
      "LÚLA SANTANA",
      "Márcia Conceição",
      "Ana-Maria Ñandú",
    ]) {
      const { rows } = await db.query<{ k: string }>("select normalizar_nome_arquiteto($1) as k", [
        nome,
      ]);
      expect(rows[0].k).toBe(normalizarNomeArquiteto(nome));
    }
  });
});

describe("restrições do aniversário", () => {
  const inserir = (dia: string, mes: string, ano = "null") =>
    db.exec(
      `insert into arquitetos (nome, aniversario_dia, aniversario_mes, aniversario_ano, criado_por)
       values ('Teste ${dia}/${mes}', ${dia}, ${mes}, ${ano}, '${GERENTE}')`,
    );

  it("aceita 29/02, com ou sem ano", async () => {
    await inserir("29", "2");
    await inserir("1", "1", "1980");
  });
  it("recusa 31/04, dia sem mês e ano sem dia", async () => {
    await expect(inserir("31", "4")).rejects.toThrow();
    await expect(inserir("5", "null")).rejects.toThrow();
    await expect(
      db.exec(
        `insert into arquitetos (nome, aniversario_ano, criado_por) values ('Só ano', 1990, '${GERENTE}')`,
      ),
    ).rejects.toThrow();
  });
});

describe("RLS do cadastro", () => {
  it("todos leem os ativos; o inativo só a gerência vê", async () => {
    const ativos = async (u: string) =>
      (
        await comoUsuario<{ nome: string }>(db, u, "select nome from arquitetos order by nome")
      ).rows.map((r) => r.nome);
    expect(await ativos(ALINE)).not.toContain("Antigo Inativo");
    expect(await ativos(KELY)).toContain("Lula Santana");
    expect(await ativos(GERENTE)).toContain("Antigo Inativo");
  });

  it("a vendedora cria em nome próprio, mas não em nome de outra", async () => {
    await comoUsuario(
      db,
      ALINE,
      "insert into arquitetos (nome, criado_por) values ('Nova Arquiteta', $1)",
      [ALINE],
    );
    await expect(
      comoUsuario(db, ALINE, "insert into arquitetos (nome, criado_por) values ('Falsa', $1)", [
        KELY,
      ]),
    ).rejects.toThrow();
  });

  it("a vendedora não edita nem apaga; a gerente edita", async () => {
    const editou = await comoUsuario(
      db,
      ALINE,
      "update arquitetos set escritorio = 'Trocado' where id = $1 returning id",
      [ARQ_LULA],
    );
    expect(editou.rows).toHaveLength(0);
    const apagou = await comoUsuario(
      db,
      ALINE,
      "delete from arquitetos where id = $1 returning id",
      [ARQ_LULA],
    );
    expect(apagou.rows).toHaveLength(0);
    const g = await comoUsuario(
      db,
      GERENTE,
      "update arquitetos set escritorio = 'Santana Arq.' where id = $1 returning id",
      [ARQ_LULA],
    );
    expect(g.rows).toHaveLength(1);
  });

  it("ninguém grava em anon", async () => {
    await db.exec("reset role; set role anon");
    await expect(db.exec("select * from arquitetos")).rejects.toThrow();
    await db.exec("reset role");
  });
});

describe("listar_arquitetos", () => {
  it("a vendedora vê só os números dos próprios orçamentos", async () => {
    const aline = (await listar(ALINE)).find((a) => a.id === ARQ_LULA);
    expect(aline).toMatchObject({ indicados: 2, fechados: 1 });
    expect(Number(aline.vendido)).toBe(1800);
    const kely = (await listar(KELY)).find((a) => a.id === ARQ_LULA);
    expect(kely).toMatchObject({ indicados: 1, fechados: 1 });
    expect(Number(kely.vendido)).toBe(8500);
  });

  it("a gerência soma tudo", async () => {
    const g = (await listar(GERENTE)).find((a) => a.id === ARQ_LULA);
    expect(g).toMatchObject({ indicados: 3, fechados: 2 });
    expect(Number(g.vendido)).toBe(10300);
  });

  it("busca por nome ou escritório e esconde inativos por padrão", async () => {
    expect((await listar(ALINE, { q: "santana arq" })).map((a) => a.id)).toContain(ARQ_LULA);
    expect((await listar(ALINE, { q: "antigo" })).length).toBe(0);
    expect((await listar(GERENTE, { q: "antigo", inativos: true })).length).toBe(1);
  });
});

describe("nome do cadastro nos clientes", () => {
  it("o cliente recebe o nome do arquiteto e acompanha a renomeação", async () => {
    const antes = await db.query<{ arquiteto_indicador: string }>(
      "select arquiteto_indicador from clientes where id = $1",
      [cli(1)],
    );
    expect(antes.rows[0].arquiteto_indicador).toBe("Lula Santana");
    await db.exec(`update arquitetos set nome = 'Lula S. Santana' where id = '${ARQ_LULA}'`);
    const depois = await db.query<{ arquiteto_indicador: string }>(
      "select arquiteto_indicador from clientes where arquiteto_id = $1 order by id",
      [ARQ_LULA],
    );
    expect(depois.rows.map((r) => r.arquiteto_indicador)).toEqual([
      "Lula S. Santana",
      "Lula S. Santana",
    ]);
  });
});

describe("juntar_arquitetos", () => {
  it("a vendedora não junta", async () => {
    await expect(
      comoUsuario(db, ALINE, "select juntar_arquitetos($1, $2)", [ARQ_LULA, ARQ_LULA2]),
    ).rejects.toThrow(/Só a gerência/);
  });

  it("a gerente move orçamentos e clientes, completa dados e registra o evento", async () => {
    const r = await comoUsuario<{ r: any }>(db, GERENTE, "select juntar_arquitetos($1, $2) as r", [
      ARQ_LULA,
      ARQ_LULA2,
    ]);
    expect(r.rows[0].r).toMatchObject({ orcamentos: 1, clientes: 1 });
    const orcs = await db.query<{ n: number }>(
      "select count(*)::int as n from orcamentos where arquiteto_id = $1",
      [ARQ_LULA],
    );
    expect(orcs.rows[0].n).toBe(4);
    const gone = await db.query("select 1 from arquitetos where id = $1", [ARQ_LULA2]);
    expect(gone.rows).toHaveLength(0);
    const ev = await db.query<{ tipo: string; detalhes: any }>(
      "select tipo, detalhes from eventos_arquiteto where arquiteto_id = $1",
      [ARQ_LULA],
    );
    expect(ev.rows[0]).toMatchObject({ tipo: "juntou" });
    expect(ev.rows[0].detalhes.orcamentos).toBe(1);
  });

  it("recusa juntar um arquiteto com ele mesmo", async () => {
    await expect(
      comoUsuario(db, GERENTE, "select juntar_arquitetos($1, $1)", [ARQ_LULA]),
    ).rejects.toThrow(/dois arquitetos diferentes/);
  });

  it("a vendedora não lê o histórico de fusões", async () => {
    const ev = await comoUsuario(db, ALINE, "select * from eventos_arquiteto");
    expect(ev.rows).toHaveLength(0);
  });
});
