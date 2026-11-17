/* eslint-disable @typescript-eslint/no-explicit-any -- JSON das funções SQL */
// Dia 12D no Postgres local (PGlite): orçamento REAL de cliente "Testa", "Celeste" ou "Contestado" não
// sai dos números; os de teste de verdade saem. A regra em SQL e a em TypeScript concordam.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";
import { clienteEhDeTeste, NOMES_PARA_REGRA_DE_TESTE } from "./eh-teste";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
let db: PGlite;

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
  `);
  for (const [i, [nome]] of NOMES_PARA_REGRA_DE_TESTE.entries()) {
    const n = String(i + 10);
    await db.exec(`
      insert into clientes (id, vendedora_id, nome) values ('00000000-0000-0000-0000-0000000000${n}', '${ALINE}', '${nome.replace(/'/g, "''")}');
      insert into orcamentos (id, vendedora_id, cliente_id, valor_total, criado_em)
        values ('00000000-0000-0000-0000-00000000${7000 + i}', '${ALINE}', '00000000-0000-0000-0000-0000000000${n}', 100, '2026-11-05 12:00-03');
    `);
  }
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("orcamento_eh_teste e a view orcamentos_reais", () => {
  it("o SQL e o TypeScript concordam em todos os nomes", async () => {
    const { rows } = await db.query<{ nome: string; teste: boolean }>(
      `select c.nome, orcamento_eh_teste(o.respostas, o.cliente_id) as teste
         from orcamentos o join clientes c on c.id = o.cliente_id`,
    );
    expect(rows).toHaveLength(NOMES_PARA_REGRA_DE_TESTE.length);
    for (const r of rows) {
      expect(r.teste, r.nome).toBe(clienteEhDeTeste(r.nome));
      expect(r.teste, r.nome).toBe(NOMES_PARA_REGRA_DE_TESTE.find(([n]) => n === r.nome)![1]);
    }
  });

  it("os números (metricas_orcamentos) contam os reais e deixam os de teste de fora", async () => {
    const reais = NOMES_PARA_REGRA_DE_TESTE.filter(([, teste]) => !teste).length;
    const r = await comoUsuario<{ r: any }>(
      db,
      GERENTE,
      "select metricas_orcamentos('2026-11-01', '2026-11-30', null) as r",
    );
    const aline = r.rows[0].r.vendedoras.find((v: any) => v.nome === "Aline");
    expect(aline.criados).toBe(reais);
  });

  it("a view orcamentos_reais traz exatamente os de cliente real", async () => {
    const r = await comoUsuario<{ nome: string }>(
      db,
      GERENTE,
      "select c.nome from orcamentos_reais o join clientes c on c.id = o.cliente_id order by c.nome",
    );
    const esperados = NOMES_PARA_REGRA_DE_TESTE.filter(([, t]) => !t)
      .map(([n]) => n)
      .sort();
    expect(r.rows.map((x) => x.nome).sort()).toEqual(esperados);
    for (const n of ["Testa", "Celeste", "Contestado"])
      expect(r.rows.map((x) => x.nome)).toContain(n);
  });
});
