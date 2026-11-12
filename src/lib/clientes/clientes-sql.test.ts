/* eslint-disable @typescript-eslint/no-explicit-any -- JSON das funções SQL */
// Dia 10D no Postgres local (PGlite): lista de clientes, observações, duplicados e fusão.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const cli = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const orc = (n: number) => `00000000-0000-0000-0000-00000000${String(5000 + n)}`;

let db: PGlite;

const listar = (usuario: string, p: Record<string, unknown> = {}) =>
  comoUsuario<{ r: any }>(db, usuario, "select listar_clientes($1::jsonb) as r", [
    JSON.stringify(p),
  ]).then((x) => x.rows[0].r);
const nomes = (r: any) => (r.itens as any[]).map((i) => i.nome);

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into clientes (id, vendedora_id, nome, whatsapp, tipo, arquiteto_indicador, observacoes) values
      ('${cli(1)}', '${ALINE}', 'Maria Silva', '+55 82 99988-7766', 'final', null, 'prefere fita 3000 K'),
      ('${cli(2)}', '${ALINE}', 'Maria Silva Santos', '+5582999887766', 'final', null, 'obra termina em dezembro'),
      ('${cli(3)}', '${ALINE}', 'João Pereira', '+5582911112222', 'arquiteto', null, null),
      ('${cli(4)}', '${ALINE}', 'Construtora Alfa', '+558233334444', 'construtora', 'Ana Arquiteta', null),
      ('${cli(5)}', '${KELY}', 'Maria Silva', '+5582900000000', 'final', null, null),
      ('${cli(6)}', '${KELY}', 'Zé Carlos', null, 'final', null, null);
    insert into orcamentos (id, vendedora_id, cliente_id, valor_total, criado_em) values
      ('${orc(1)}', '${ALINE}', '${cli(1)}', 1000, '2026-11-01 12:00-03'),
      ('${orc(2)}', '${ALINE}', '${cli(1)}', 2000, '2026-11-05 12:00-03'),
      ('${orc(3)}', '${ALINE}', '${cli(2)}', 500, '2026-11-08 12:00-03'),
      ('${orc(4)}', '${KELY}', '${cli(5)}', 700, '2026-11-02 12:00-03');
    update orcamentos set status = 'fechado', valor_fechado = 1800, fechado_em = now() where id = '${orc(1)}';
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("listar_clientes", () => {
  it("a vendedora vê só os próprios clientes, mesmo com nome repetido na outra", async () => {
    expect(nomes(await listar(ALINE))).toEqual([
      "Construtora Alfa",
      "João Pereira",
      "Maria Silva",
      "Maria Silva Santos",
    ]);
    expect(nomes(await listar(KELY))).toEqual(["Maria Silva", "Zé Carlos"]);
    expect((await listar(GERENTE)).total).toBe(6);
  });

  it("resumo por cliente: orçamentos, fechados, vendido e data do último", async () => {
    const r = await listar(ALINE, { q: "Maria Silva Santos" });
    expect(r.itens[0]).toMatchObject({ orcamentos: 1, fechados: 0 });
    const m = (await listar(ALINE, { q: "João" })).itens[0];
    expect(m).toMatchObject({ orcamentos: 0, ultimo_em: null });
    const maria = (await listar(ALINE, { q: "maria silva" })).itens.find(
      (i: any) => i.nome === "Maria Silva",
    );
    expect(maria).toMatchObject({ orcamentos: 2, fechados: 1 });
    expect(Number(maria.vendido)).toBe(1800); // valor fechado, não o total
    expect(maria.ultimo_em).toContain("2026-11-05"); // o último orçamento criado
  });

  it("busca por nome, WhatsApp (só dígitos, com máscara) e arquiteto", async () => {
    expect(nomes(await listar(ALINE, { q: "alfa" }))).toEqual(["Construtora Alfa"]);
    expect(nomes(await listar(ALINE, { q: "(82) 9998" }))).toEqual([
      "Maria Silva",
      "Maria Silva Santos",
    ]);
    expect(nomes(await listar(ALINE, { q: "ana arq" }))).toEqual(["Construtora Alfa"]);
    expect((await listar(ALINE, { q: "%" })).total).toBe(0);
  });

  it("a gerência filtra por vendedora; a vendedora pedindo a outra não recebe nada", async () => {
    expect(nomes(await listar(GERENTE, { vendedora: KELY }))).toEqual(["Maria Silva", "Zé Carlos"]);
    expect((await listar(ALINE, { vendedora: KELY })).total).toBe(0);
  });

  it("paginação por cursor sem repetir nem perder", async () => {
    const vistos: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const p: any = await listar(GERENTE, { limite: 2, ...(cursor ? { cursor } : {}) });
      vistos.push(...p.itens.map((i: any) => i.id));
      cursor = p.proximo;
      paginas++;
    } while (cursor && paginas < 10);
    expect(paginas).toBe(3);
    expect(new Set(vistos).size).toBe(6);
  });
});

describe("observações do cliente", () => {
  it("a dona edita; outra vendedora não; limite de 1.000 caracteres", async () => {
    const ok = await comoUsuario(
      db,
      ALINE,
      "update clientes set observacoes = $1 where id = $2 returning id",
      ["prefere fita 3000 K, obra termina em dezembro", cli(3)],
    );
    expect(ok.rows).toHaveLength(1);
    const alheio = await comoUsuario(
      db,
      ALINE,
      "update clientes set observacoes = 'x' where id = $1 returning id",
      [cli(5)],
    );
    expect(alheio.rows).toHaveLength(0);
    await expect(
      db.query("update clientes set observacoes = $1 where id = $2", ["x".repeat(1001), cli(3)]),
    ).rejects.toThrow();
  });

  it("a ficha por URL direta: Aline não lê cliente da Kely", async () => {
    const r = await comoUsuario(db, ALINE, "select id from clientes where id = $1", [cli(5)]);
    expect(r.rows).toHaveLength(0);
  });
});

describe("possiveis_duplicados e juntar_clientes", () => {
  it("acha o par da mesma vendedora (WhatsApp igual e nome parecido); não cruza vendedoras", async () => {
    const { rows } = await comoUsuario<{ r: any[] }>(
      db,
      GERENTE,
      "select possiveis_duplicados() as r",
    );
    const pares = rows[0].r;
    expect(pares).toHaveLength(1);
    expect(pares[0]).toMatchObject({
      a_nome: "Maria Silva",
      b_nome: "Maria Silva Santos",
      motivo: "whatsapp",
    });
    // o "Maria Silva" da Kely não entra no par da Aline
    expect(pares.some((p: any) => p.a_id === cli(5) || p.b_id === cli(5))).toBe(false);
  });

  it("a vendedora não vê duplicados nem junta", async () => {
    await expect(comoUsuario(db, ALINE, "select possiveis_duplicados()")).rejects.toThrow(
      "SEM_PERMISSAO",
    );
    await expect(
      comoUsuario(db, ALINE, "select juntar_clientes($1, $2)", [cli(1), cli(2)]),
    ).rejects.toThrow("SEM_PERMISSAO");
  });

  it("recusa clientes de vendedoras diferentes, o mesmo cliente e cliente inexistente", async () => {
    await expect(
      comoUsuario(db, GERENTE, "select juntar_clientes($1, $2)", [cli(1), cli(5)]),
    ).rejects.toThrow("VENDEDORAS_DIFERENTES");
    await expect(
      comoUsuario(db, GERENTE, "select juntar_clientes($1, $1)", [cli(1)]),
    ).rejects.toThrow("MESMO_CLIENTE");
    await expect(
      comoUsuario(db, GERENTE, "select juntar_clientes($1, $2)", [cli(1), cli(60)]),
    ).rejects.toThrow("CLIENTE_NAO_ENCONTRADO");
  });

  it("a gerência junta: move os orçamentos, junta as observações, registra e apaga o outro", async () => {
    const r = await comoUsuario<{ r: any }>(db, GERENTE, "select juntar_clientes($1, $2) as r", [
      cli(1),
      cli(2),
    ]);
    expect(r.rows[0].r).toEqual({ movidos: 1 });
    const { rows: orcs } = await db.query<{ cliente_id: string }>(
      `select cliente_id from orcamentos where id = '${orc(3)}'`,
    );
    expect(orcs[0].cliente_id).toBe(cli(1));
    const { rows: c } = await db.query<{ observacoes: string }>(
      `select observacoes from clientes where id = '${cli(1)}'`,
    );
    expect(c[0].observacoes).toBe("prefere fita 3000 K\nobra termina em dezembro");
    expect((await db.query(`select 1 from clientes where id = '${cli(2)}'`)).rows).toHaveLength(0);
    const { rows: reg } = await db.query<{
      removido: any;
      orcamentos_movidos: number;
      por: string;
    }>("select removido, orcamentos_movidos, por from clientes_fusoes");
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ orcamentos_movidos: 1, por: GERENTE });
    expect(reg[0].removido).toMatchObject({
      nome: "Maria Silva Santos",
      observacoes: "obra termina em dezembro",
    });
  });

  it("o registro das fusões é só da gerência e ninguém grava pelo cliente", async () => {
    const dela = await comoUsuario(db, ALINE, "select * from clientes_fusoes");
    expect(dela.rows).toHaveLength(0);
    const g = await comoUsuario(db, GERENTE, "select * from clientes_fusoes");
    expect(g.rows).toHaveLength(1);
    await expect(
      comoUsuario(db, GERENTE, "insert into clientes_fusoes (removido) values ('{}'::jsonb)"),
    ).rejects.toThrow();
  });

  it("depois da fusão o cliente mantido tem os dois orçamentos e não há mais duplicados", async () => {
    const maria = (await listar(ALINE, { q: "Maria Silva" })).itens[0];
    expect(maria).toMatchObject({ nome: "Maria Silva", orcamentos: 3 });
    const { rows } = await comoUsuario<{ r: any[] }>(
      db,
      GERENTE,
      "select possiveis_duplicados() as r",
    );
    expect(rows[0].r).toHaveLength(0);
  });
});
