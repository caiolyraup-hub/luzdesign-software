/* eslint-disable @typescript-eslint/no-explicit-any -- JSON das funções SQL */
// Dia 14 no PGlite: origem "kit" nos itens, filtro "Piloto" na lista de orçamentos.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const CLI = "c0000000-0000-0000-0000-000000000001";
const O_PILOTO = "b0000000-0000-0000-0000-000000000001";
const O_COMUM = "b0000000-0000-0000-0000-000000000002";
let db: PGlite;

beforeAll(async () => {
  db = await criarBancoLocal();
  // A marca automática depende da data (piloto_inicio); os testes não podem depender do relógio.
  await db.exec("update configuracoes_loja set piloto_inicio = now() + interval '1 year'");
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'caiolyra.up+aline@gmail.com', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'caiolyra.up+gerencia@gmail.com', 'gerente');
    insert into clientes (id, vendedora_id, nome) values ('${CLI}', '${ALINE}', 'Maria Souza');
    insert into orcamentos (id, vendedora_id, cliente_id, valor_total, piloto) values
      ('${O_PILOTO}', '${ALINE}', '${CLI}', 100, true),
      ('${O_COMUM}', '${ALINE}', '${CLI}', 200, false);
  `);
}, 60_000);
beforeEach(async () => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)");
});
afterAll(async () => {
  await db.close();
});

describe("origem 'kit'", () => {
  it("aceita kit e continua recusando origem inventada", async () => {
    await db.exec(`insert into orcamento_itens (orcamento_id, descricao_congelada, preco_unitario_congelado, quantidade, avulso, origem)
      values ('${O_PILOTO}', 'Fita LED', 10, 1, true, 'kit')`);
    await expect(
      db.exec(`insert into orcamento_itens (orcamento_id, descricao_congelada, preco_unitario_congelado, quantidade, avulso, origem)
        values ('${O_PILOTO}', 'X', 10, 1, true, 'inventada')`),
    ).rejects.toThrow();
  });

  it("itens antigos continuam como estão (manual)", async () => {
    await db.exec(`insert into orcamento_itens (orcamento_id, descricao_congelada, preco_unitario_congelado, quantidade, avulso)
      values ('${O_COMUM}', 'Antigo', 10, 1, true)`);
    const r = await db.query<{ origem: string }>(
      `select origem from orcamento_itens where descricao_congelada = 'Antigo'`,
    );
    expect(r.rows[0].origem).toBe("manual");
  });
});

describe("filtro Piloto em listar_orcamentos", () => {
  const ids = async (p: object) => {
    const r = await comoUsuario<{ r: any }>(
      db,
      GERENTE,
      `select listar_orcamentos('${JSON.stringify({ limite: 50, status: [], ...p })}'::jsonb) as r`,
    );
    return r.rows[0].r.itens.map((i: any) => i.id) as string[];
  };

  it("sem o filtro traz os dois; com piloto=1 só o marcado", async () => {
    expect((await ids({})).sort()).toEqual([O_PILOTO, O_COMUM].sort());
    expect(await ids({ piloto: "1" })).toEqual([O_PILOTO]);
  });

  it("combina com os outros filtros e com a contagem por status", async () => {
    expect(await ids({ piloto: "1", vendedora: ALINE })).toEqual([O_PILOTO]);
    const r = await comoUsuario<{ r: any }>(
      db,
      GERENTE,
      `select listar_orcamentos('{"limite":50,"status":[],"piloto":"1"}'::jsonb) as r`,
    );
    expect(Number(r.rows[0].r.total)).toBe(1);
  });

  it("a gerência marca e desmarca pela função e o filtro acompanha", async () => {
    await comoUsuario(db, GERENTE, `select marcar_piloto('${O_COMUM}', true)`);
    expect((await ids({ piloto: "1" })).sort()).toEqual([O_PILOTO, O_COMUM].sort());
    await comoUsuario(db, GERENTE, `select marcar_piloto('${O_COMUM}', false)`);
    expect(await ids({ piloto: "1" })).toEqual([O_PILOTO]);
  });
});
