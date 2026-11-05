// Testa a gravação atômica dos itens e o isolamento de uso_ia num Postgres local (PGlite).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const ORC_ALINE = "00000000-0000-0000-0000-0000000000a1";
const ORC_KELY = "00000000-0000-0000-0000-0000000000b1";
const ORC_GERADO = "00000000-0000-0000-0000-0000000000a2";

let db: PGlite;

const itens = (...linhas: Record<string, unknown>[]) => JSON.stringify(linhas);
const linha = (ordem: number, extra: Record<string, unknown> = {}) => ({
  codigo: "9520",
  descricao_congelada: "STELLA DIC 6W 2.7K",
  preco_unitario_congelado: 37,
  quantidade: 2,
  ambiente: "Sala",
  avulso: false,
  justificativa: "teste",
  ordem,
  ...extra,
});

const substituir = (usuario: string, orcamento: string, json: string, total = 74) =>
  comoUsuario(db, usuario, "select substituir_itens_orcamento($1, $2::jsonb, $3, $4::jsonb)", [
    orcamento,
    json,
    total,
    JSON.stringify({ geracoes: 1, pendencias: [], avisos: [], resumo: "ok", modelo: "teste" }),
  ]);

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora');
    insert into produtos (codigo, descricao, unidade, preco_unitario) values
      ('9520', 'STELLA DIC 6W 2.7K', 'un', 37),
      ('12222', 'MTS FITA 22W/M NT NIT', 'm', 20);
    insert into clientes (id, vendedora_id, nome) values
      ('00000000-0000-0000-0000-0000000000c1', '${ALINE}', 'TESTE A'),
      ('00000000-0000-0000-0000-0000000000c2', '${KELY}', 'TESTE K');
    insert into orcamentos (id, vendedora_id, cliente_id, status) values
      ('${ORC_ALINE}', '${ALINE}', '00000000-0000-0000-0000-0000000000c1', 'rascunho'),
      ('${ORC_GERADO}', '${ALINE}', '00000000-0000-0000-0000-0000000000c1', 'gerado'),
      ('${ORC_KELY}', '${KELY}', '00000000-0000-0000-0000-0000000000c2', 'rascunho');
    insert into uso_ia (orcamento_id, vendedora_id, status) values ('${ORC_ALINE}', '${ALINE}', 'ok');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("substituir_itens_orcamento", () => {
  it("grava itens, total e resultado; uma nova geração substitui a anterior", async () => {
    await substituir(
      ALINE,
      ORC_ALINE,
      itens(linha(0), linha(1, { codigo: "12222", quantidade: 5.5, ambiente: "Cozinha" })),
      258,
    );
    let r = await db.query<{ n: number }>(
      `select count(*)::int n from orcamento_itens where orcamento_id = '${ORC_ALINE}'`,
    );
    expect(r.rows[0].n).toBe(2);

    await substituir(ALINE, ORC_ALINE, itens(linha(0, { quantidade: 4 })), 148);
    r = await db.query(
      `select count(*)::int n from orcamento_itens where orcamento_id = '${ORC_ALINE}'`,
    );
    expect(r.rows[0].n).toBe(1);

    const o = await db.query<{
      valor_total: string;
      montado_em: string | null;
      montagem: { geracoes: number };
      status: string;
    }>(
      `select valor_total, montado_em, montagem, status from orcamentos where id = '${ORC_ALINE}'`,
    );
    expect(Number(o.rows[0].valor_total)).toBe(148);
    expect(o.rows[0].montado_em).not.toBeNull();
    expect(o.rows[0].montagem.geracoes).toBe(1);
    expect(o.rows[0].status).toBe("rascunho");
  });

  it("item avulso entra sem código e com preço 0", async () => {
    await substituir(
      ALINE,
      ORC_ALINE,
      itens(
        linha(0),
        linha(1, {
          codigo: null,
          avulso: true,
          descricao_congelada: "Pendente 3 globos",
          preco_unitario_congelado: 0,
          quantidade: 1,
        }),
      ),
      74,
    );
    const r = await db.query<{ codigo: string | null; avulso: boolean }>(
      `select codigo, avulso from orcamento_itens where orcamento_id = '${ORC_ALINE}' order by ordem`,
    );
    expect(r.rows).toEqual([
      { codigo: "9520", avulso: false },
      { codigo: null, avulso: true },
    ]);
  });

  it("é atômica: se um item for inválido, os itens antigos continuam", async () => {
    await substituir(ALINE, ORC_ALINE, itens(linha(0), linha(1)), 148);
    await expect(
      substituir(ALINE, ORC_ALINE, itens(linha(0, { quantidade: 0 })), 0),
    ).rejects.toThrow();
    const r = await db.query<{ n: number }>(
      `select count(*)::int n from orcamento_itens where orcamento_id = '${ORC_ALINE}'`,
    );
    expect(r.rows[0].n).toBe(2);
    const o = await db.query<{ valor_total: string }>(
      `select valor_total from orcamentos where id = '${ORC_ALINE}'`,
    );
    expect(Number(o.rows[0].valor_total)).toBe(148);
  });

  it("não mexe em orçamento de outra vendedora nem fora de rascunho", async () => {
    await expect(substituir(ALINE, ORC_KELY, itens(linha(0)))).rejects.toThrow(
      /não encontrado|rascunho/,
    );
    await expect(substituir(ALINE, ORC_GERADO, itens(linha(0)))).rejects.toThrow(
      /não encontrado|rascunho/,
    );
    const r = await db.query<{ n: number }>(
      `select count(*)::int n from orcamento_itens where orcamento_id in ('${ORC_KELY}', '${ORC_GERADO}')`,
    );
    expect(r.rows[0].n).toBe(0);
  });
});

describe("uso_ia", () => {
  it("a vendedora não lê uso_ia nem grava nele", async () => {
    const lido = await comoUsuario(db, ALINE, "select * from uso_ia");
    expect(lido.rows).toEqual([]);
    await expect(
      comoUsuario(db, ALINE, "insert into uso_ia (orcamento_id, status) values ($1, 'ok')", [
        ORC_ALINE,
      ]),
    ).rejects.toThrow();
  });

  it("status só aceita em_andamento, ok ou erro", async () => {
    await expect(
      db.exec(`insert into uso_ia (orcamento_id, status) values ('${ORC_ALINE}', 'talvez')`),
    ).rejects.toThrow();
  });
});
