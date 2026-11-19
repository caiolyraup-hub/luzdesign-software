// Dia 13B no PGlite: o go-live nunca seleciona orçamento piloto nem o que está ligado a ele, mesmo
// quando o nome do cliente é "TESTE…"; o seed de teste de verdade continua sendo selecionado.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBancoLocal } from "../testes/banco-local";
import { selecionarLixoDeTeste, type ArqLinha, type CliLinha, type OrcLinha } from "./selecao";

const ALINE = "00000000-0000-0000-0000-00000000000a";
let db: PGlite;

beforeAll(async () => {
  db = await criarBancoLocal();
  // A marca automática depende da data (piloto_inicio); os testes não podem depender do relógio.
  await db.exec("update configuracoes_loja set piloto_inicio = now() + interval '1 year'");
  await db.exec(`
    insert into auth.users values ('${ALINE}');
    insert into usuarios values ('${ALINE}', 'Aline', 'caiolyra.up+aline@gmail.com', 'vendedora');
    insert into arquitetos (id, nome) values
      ('a0000000-0000-0000-0000-000000000001', 'Arquiteto Teste Seed'),
      ('a0000000-0000-0000-0000-000000000002', 'Arq do piloto teste'),
      ('a0000000-0000-0000-0000-000000000003', 'Arq do cliente piloto teste'),
      ('a0000000-0000-0000-0000-000000000004', 'Arquiteta Real');
    insert into clientes (id, vendedora_id, nome, arquiteto_id) values
      ('c0000000-0000-0000-0000-000000000001', '${ALINE}', 'TESTE Cliente A de Aline', null),
      ('c0000000-0000-0000-0000-000000000002', '${ALINE}', 'Teste da dona Maria', 'a0000000-0000-0000-0000-000000000003'),
      ('c0000000-0000-0000-0000-000000000003', '${ALINE}', 'João Real', null),
      ('c0000000-0000-0000-0000-000000000004', '${ALINE}', 'COM E2E Cliente', null);
    -- seed de teste (não piloto), piloto com cliente de nome "Teste", piloto com arquiteto, real antigo
    insert into orcamentos (id, numero, vendedora_id, cliente_id, arquiteto_id, valor_total, piloto, respostas) values
      ('b0000000-0000-0000-0000-000000000001', '2026-0001', '${ALINE}', 'c0000000-0000-0000-0000-000000000001', null, 1, false, '{"teste":true}'),
      ('b0000000-0000-0000-0000-000000000002', '2026-0020', '${ALINE}', 'c0000000-0000-0000-0000-000000000002', null, 1, true, '{}'),
      ('b0000000-0000-0000-0000-000000000003', '2026-0021', '${ALINE}', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 1, true, '{}'),
      ('b0000000-0000-0000-0000-000000000004', '2026-0030', '${ALINE}', 'c0000000-0000-0000-0000-000000000004', null, 1, false, '{}');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function carregar() {
  const o = await db.query<OrcLinha>(
    `select o.id, o.numero, o.cliente_id, o.arquiteto_id, o.piloto, o.respostas, c.nome as cliente_nome
       from orcamentos o join clientes c on c.id = o.cliente_id`,
  );
  const c = await db.query<CliLinha>("select id, nome, arquiteto_id from clientes");
  const a = await db.query<ArqLinha>("select id, nome from arquitetos");
  return { orcamentos: o.rows, clientes: c.rows, arquitetos: a.rows };
}

describe("selecionarLixoDeTeste com dados vindos do banco", () => {
  it("seleciona o seed de teste e o teste automatizado", async () => {
    const r = selecionarLixoDeTeste(await carregar());
    expect(r.orcamentos.map((x) => x.o.numero).sort()).toEqual(["2026-0001", "2026-0030"]);
    expect(r.clientes.map((c) => c.nome).sort()).toEqual([
      "COM E2E Cliente",
      "TESTE Cliente A de Aline",
    ]);
    expect(r.arquitetos.map((a) => a.nome)).toEqual(["Arquiteto Teste Seed"]);
  });

  it("nunca seleciona orçamento piloto, nem o cliente 'Teste…' dele, nem os arquitetos ligados", async () => {
    const r = selecionarLixoDeTeste(await carregar());
    const numeros = r.orcamentos.map((x) => x.o.numero);
    expect(numeros).not.toContain("2026-0020");
    expect(numeros).not.toContain("2026-0021");
    expect(r.clientes.map((c) => c.nome)).not.toContain("Teste da dona Maria");
    // arquiteto do orçamento piloto (direto) e do cliente do piloto (pelo cliente) ficam
    expect(r.arquitetos.map((a) => a.nome)).not.toContain("Arq do piloto teste");
    expect(r.arquitetos.map((a) => a.nome)).not.toContain("Arq do cliente piloto teste");
    expect(r.protegidos.orcamentos.map((o) => o.numero).sort()).toEqual(["2026-0020", "2026-0021"]);
    expect(r.protegidos.arquitetos).toHaveLength(2);
  });

  it("sem a marca de piloto, o mesmo orçamento 'Teste…' seria lixo (a marca é o que protege)", async () => {
    await db.exec("update orcamentos set piloto = false where numero = '2026-0020'");
    const r = selecionarLixoDeTeste(await carregar());
    expect(r.orcamentos.map((x) => x.o.numero)).toContain("2026-0020");
    await db.exec("update orcamentos set piloto = true where numero = '2026-0020'");
  });

  it("apagar o que foi selecionado (como o go-live faria) não deixa o piloto sem cliente ou itens", async () => {
    const r = selecionarLixoDeTeste(await carregar());
    for (const { o } of r.orcamentos)
      await db.query("delete from orcamentos where id = $1", [o.id]);
    for (const c of r.clientes) await db.query("delete from clientes where id = $1", [c.id]);
    for (const a of r.arquitetos) await db.query("delete from arquitetos where id = $1", [a.id]);
    const sobrou = await db.query<{ n: string }>(
      "select count(*)::text n from orcamentos where piloto",
    );
    expect(sobrou.rows[0].n).toBe("2");
    const cli = await db.query<{ n: string }>(
      "select count(*)::text n from orcamentos o join clientes c on c.id = o.cliente_id where o.piloto",
    );
    expect(cli.rows[0].n).toBe("2");
  });
});
