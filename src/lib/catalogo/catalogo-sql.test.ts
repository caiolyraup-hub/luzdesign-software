// Dia 11C no Postgres local (PGlite): fabricante, referência e modelo só a gerência lê; a vendedora
// traduz a referência do arquiteto em código interno sem enumerar o catálogo.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

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
    insert into produtos (codigo, categoria, descricao, unidade, preco_unitario) values
      ('11343', 'SPOT', 'SPOT EMBUT PT 5W 3.0K', 'un', 52),
      ('12785', 'EMBUTIDO', 'EMBUTIDO 10W BR 3K', 'un', 60),
      ('12222', 'FITA LED', 'MTS FITA 22W/M NT', 'm', 20);
    insert into produtos_dados_fornecedor (codigo, fabricante, referencia_fabricante, modelo, descricao_fornecedor) values
      ('11343', 'MB', '6338', 'BLET', 'MB BLET 6338 EMBUT PT 5W 3.0K'),
      ('12785', 'ASTRA', 'DL-7324 / 1152/1', null, 'DL-7324 10W BR 3K ASTRA'),
      ('12222', 'NIT', null, null, 'MTS FITA 22W/M NT NIT');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("produtos_dados_fornecedor (RLS)", () => {
  it("a vendedora não lê nada da tabela; a gerência lê", async () => {
    const a = await comoUsuario(db, ALINE, "select * from produtos_dados_fornecedor");
    expect(a.rows).toHaveLength(0);
    const g = await comoUsuario(db, GERENTE, "select * from produtos_dados_fornecedor");
    expect(g.rows).toHaveLength(3);
  });

  it("a vendedora não escreve; sem login (anon) a tabela nem abre", async () => {
    await expect(
      comoUsuario(
        db,
        ALINE,
        "insert into produtos_dados_fornecedor (codigo, fabricante) values ('12222', 'X')",
      ),
    ).rejects.toThrow();
    const up = await comoUsuario(
      db,
      ALINE,
      "update produtos_dados_fornecedor set fabricante = 'X' returning codigo",
    );
    expect(up.rows).toHaveLength(0);
    await db.exec("reset role; set role anon");
    await expect(db.exec("select * from produtos_dados_fornecedor")).rejects.toThrow();
    await db.exec("reset role");
  });

  it("a coluna marca não existe mais em produtos (nem pela API)", async () => {
    await expect(comoUsuario(db, ALINE, "select marca from produtos")).rejects.toThrow();
  });
});

describe("buscar_produtos", () => {
  const buscar = (u: string, texto: string, marca: string | null = null) =>
    comoUsuario<{ codigo: string; marca: string | null }>(
      db,
      u,
      "select codigo, marca from buscar_produtos($1, null, $2, 20)",
      [texto, marca],
    ).then((r) => r.rows);

  it("a vendedora não acha por fabricante, referência nem modelo e nunca recebe a marca", async () => {
    for (const termo of ["ASTRA", "DL-7324", "6338", "BLET"]) {
      expect(
        (await buscar(ALINE, termo)).map((r) => r.codigo),
        termo,
      ).toEqual([]);
    }
    const r = await buscar(ALINE, "spot");
    expect(r.map((x) => x.codigo)).toEqual(["11343"]);
    expect(r.every((x) => x.marca === null)).toBe(true);
  });

  it("a vendedora achando por código ou descrição comercial", async () => {
    expect((await buscar(ALINE, "11343"))[0].codigo).toBe("11343");
    expect((await buscar(ALINE, "fita 22w")).map((r) => r.codigo)).toContain("12222");
  });

  it("a gerência busca por fabricante, referência e modelo e vê a marca", async () => {
    expect((await buscar(GERENTE, "astra")).map((r) => r.codigo)).toEqual(["12785"]);
    expect((await buscar(GERENTE, "blet")).map((r) => r.codigo)).toEqual(["11343"]);
    expect((await buscar(GERENTE, "dl-7324"))[0].marca).toBe("ASTRA");
    expect((await buscar(GERENTE, "", "NIT")).map((r) => r.codigo)).toEqual(["12222"]);
  });
});

describe("buscar_por_referencia", () => {
  const ref = (u: string, texto: string) =>
    comoUsuario<{ codigo: string; descricao: string }>(
      db,
      u,
      "select * from buscar_por_referencia($1)",
      [texto],
    ).then((r) => r.rows);

  it("referência inteira (qualquer caixa, hífen e espaço) devolve só código e descrição comercial", async () => {
    for (const texto of ["DL-7324", "dl7324", " dl 7324 ", "1152/1"]) {
      const r = await ref(ALINE, texto);
      expect(r, texto).toEqual([{ codigo: "12785", descricao: "EMBUTIDO 10W BR 3K" }]);
    }
    expect(Object.keys((await ref(ALINE, "6338"))[0]).sort()).toEqual(["codigo", "descricao"]);
  });

  it("não aceita parte da referência nem devolve a referência", async () => {
    for (const texto of ["DL-73", "7324", "DL", "633", "BLET", "MB", ""]) {
      expect(await ref(ALINE, texto), texto).toEqual([]);
    }
    const r = JSON.stringify(await ref(ALINE, "DL-7324"));
    expect(r).not.toMatch(/DL-7324|ASTRA|BLET|6338/);
  });

  it("limite de 30 consultas por minuto por usuário", async () => {
    await db.exec("delete from consultas_referencia");
    for (let i = 0; i < 30; i++) await ref(ALINE, `x${i}xx`);
    await expect(ref(ALINE, "DL-7324")).rejects.toThrow(/LIMITE_CONSULTAS/);
    // outro usuário não é afetado
    expect(await ref(GERENTE, "DL-7324")).toHaveLength(1);
  });

  it("sem login não executa", async () => {
    await db.exec("reset role; set role anon");
    await expect(db.exec("select * from buscar_por_referencia('DL-7324')")).rejects.toThrow();
    await db.exec("reset role");
  });

  it("a vendedora não lê a tabela de consultas", async () => {
    await expect(comoUsuario(db, ALINE, "select * from consultas_referencia")).rejects.toThrow();
  });
});
