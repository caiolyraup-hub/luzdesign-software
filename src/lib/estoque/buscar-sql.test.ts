// Testa buscar_produtos num Postgres local (PGlite) com as migrations reais e auth/storage simulados.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarBancoLocal } from "../testes/banco-local";

let db: PGlite;

async function buscar(
  texto: string,
  extra: { categoria?: string; marca?: string; limite?: number } = {},
) {
  const r = await db.query<{ codigo: string }>(
    "select codigo from buscar_produtos($1, $2, $3, $4)",
    [texto, extra.categoria ?? null, extra.marca ?? null, extra.limite ?? 20],
  );
  return r.rows.map((x) => x.codigo);
}

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into produtos (codigo, categoria, marca, descricao, unidade, preco_unitario, ativo) values
      ('9520',  'LED',      'STELLA', 'STELLA DIC 6W 2.7K',        'un', 37, true),
      ('9521',  'LED',      'STELLA', 'STELLA DIC 9W 3.0K',        'un', 45, true),
      ('11500', 'EMBUTIDO', 'NIT',    'NIT. 12W 3.0K',             'un', 29, true),
      ('12222', 'FITA LED', 'NIT',    'MTS FITA 22W/M NT NIT',     'm',  20, true),
      ('9999',  'LED',      'STELLA', 'STELLA DIC 6W DESATIVADO',  'un', 37, false);
    insert into produto_apelidos (codigo, texto) values ('11500', '12W AM NIT'), ('9999', 'dic 6w antigo');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("buscar_produtos", () => {
  it('"dic 6w" encontra o código 9520 e não traz o inativo', async () => {
    const r = await buscar("dic 6w");
    expect(r[0]).toBe("9520");
    expect(r).not.toContain("9999");
  });

  it("encontra pelo apelido", async () => {
    expect(await buscar("12w am nit")).toContain("11500");
  });

  it("encontra pelo código, com o código exato primeiro", async () => {
    expect((await buscar("9520"))[0]).toBe("9520");
  });

  it("não devolve produto inativo nem pelo apelido do inativo", async () => {
    expect(await buscar("desativado")).not.toContain("9999");
    expect(await buscar("dic 6w antigo")).not.toContain("9999");
  });

  it("filtra por categoria e marca, e respeita o limite", async () => {
    expect(await buscar("", { categoria: "FITA LED" })).toEqual(["12222"]);
    expect(await buscar("", { marca: "NIT" })).toEqual(["11500", "12222"]);
    expect(await buscar("", { limite: 2 })).toHaveLength(2);
  });

  it("tolera erro de digitação", async () => {
    expect(await buscar("stela dic 6w")).toContain("9520");
  });

  it("texto vazio lista só os ativos", async () => {
    expect(await buscar("")).toEqual(["9520", "9521", "11500", "12222"]);
  });

  it("aceita código de 4 e 5 dígitos, mas não de 6", async () => {
    await expect(
      db.exec("insert into produtos (codigo, descricao, preco_unitario) values ('123456','x',1)"),
    ).rejects.toThrow();
  });
});
