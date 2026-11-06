// Testa gerar_orcamento, recalcular_total_orcamento e configuracoes_loja num Postgres local (PGlite).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const CLI_A = "00000000-0000-0000-0000-0000000000c1";
const CLI_K = "00000000-0000-0000-0000-0000000000c2";
const ORC = "00000000-0000-0000-0000-0000000000a1";
const ORC_VAZIO = "00000000-0000-0000-0000-0000000000a2";
const ORC_ENVIADO = "00000000-0000-0000-0000-0000000000a3";
const ORC_KELY = "00000000-0000-0000-0000-0000000000b1";

let db: PGlite;

const caminho = (orc: string, versao: number) => `${ALINE}/${orc}/2026-0001-v${versao}.pdf`;
const gerar = (usuario: string, orc: string, c: string, versao: number, total: number) =>
  comoUsuario(db, usuario, "select gerar_orcamento($1, $2, $3, $4, $5::date) as r", [
    orc,
    c,
    versao,
    total,
    "2026-11-13",
  ]);

async function itens(orc: string) {
  const r = await db.query<{
    codigo: string | null;
    preco: string;
    descricao: string;
    avulso: boolean;
  }>(
    "select codigo, preco_unitario_congelado as preco, descricao_congelada as descricao, avulso from orcamento_itens where orcamento_id = $1 order by ordem",
    [orc],
  );
  return r.rows;
}

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into produtos (codigo, descricao, unidade, preco_unitario, ativo) values
      ('9520', 'STELLA DIC 6W 2.7K', 'un', 40.00, true),
      ('12222', 'MTS FITA 22W/M NT NIT', 'm', 20.00, true),
      ('7777', 'PRODUTO DESATIVADO', 'un', 10.00, false);
    insert into clientes (id, vendedora_id, nome) values ('${CLI_A}', '${ALINE}', 'TESTE A'), ('${CLI_K}', '${KELY}', 'TESTE K');
    insert into orcamentos (id, vendedora_id, cliente_id, status) values
      ('${ORC}', '${ALINE}', '${CLI_A}', 'rascunho'),
      ('${ORC_VAZIO}', '${ALINE}', '${CLI_A}', 'rascunho'),
      ('${ORC_ENVIADO}', '${ALINE}', '${CLI_A}', 'enviado'),
      ('${ORC_KELY}', '${KELY}', '${CLI_K}', 'rascunho');
    -- preços "velhos": o catálogo mudou depois da montagem
    insert into orcamento_itens (orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem) values
      ('${ORC}', '9520', 'DESCRICAO ANTIGA', 37.00, 6, 'Sala', false, 0),
      ('${ORC}', '12222', 'MTS FITA 22W/M NT NIT', 18.00, 8.5, 'Cozinha', false, 1),
      ('${ORC}', null, 'Pendente sob medida', 890.00, 1, 'Sala', true, 2),
      ('${ORC_ENVIADO}', '9520', 'X', 40.00, 1, 'Sala', false, 0),
      ('${ORC_KELY}', '9520', 'X', 40.00, 1, 'Sala', false, 0);
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("recalcular_total_orcamento", () => {
  it("soma preço x quantidade arredondando por item", async () => {
    const r = await comoUsuario<{ t: string }>(
      db,
      ALINE,
      "select recalcular_total_orcamento($1) as t",
      [ORC],
    );
    // 6 x 37 + 8,5 x 18 + 890 = 222 + 153 + 890 = 1265
    expect(Number(r.rows[0].t)).toBe(1265);
    const o = await db.query<{ valor_total: string }>(
      "select valor_total from orcamentos where id = $1",
      [ORC],
    );
    expect(Number(o.rows[0].valor_total)).toBe(1265);
  });

  it("não mexe em orçamento de outra vendedora nem enviado", async () => {
    const outra = await comoUsuario(db, ALINE, "select recalcular_total_orcamento($1) as t", [
      ORC_KELY,
    ]);
    expect(outra.rows[0]).toEqual({ t: null });
    const enviado = await comoUsuario(db, ALINE, "select recalcular_total_orcamento($1) as t", [
      ORC_ENVIADO,
    ]);
    expect(enviado.rows[0]).toEqual({ t: null });
  });
});

describe("gerar_orcamento", () => {
  it("recusa sem itens, de outra vendedora, enviado, caminho errado e versão errada", async () => {
    await expect(gerar(ALINE, ORC_VAZIO, caminho(ORC_VAZIO, 1), 1, 0)).rejects.toThrow(/SEM_ITENS/);
    await expect(gerar(ALINE, ORC_KELY, `${ALINE}/${ORC_KELY}/x-v1.pdf`, 1, 40)).rejects.toThrow(
      /ORCAMENTO_NAO_EDITAVEL/,
    );
    await expect(gerar(ALINE, ORC_ENVIADO, caminho(ORC_ENVIADO, 1), 1, 40)).rejects.toThrow(
      /ORCAMENTO_NAO_EDITAVEL/,
    );
    await expect(gerar(ALINE, ORC, `${KELY}/${ORC}/x-v1.pdf`, 1, 1)).rejects.toThrow(
      /CAMINHO_INVALIDO/,
    );
    await expect(gerar(ALINE, ORC, caminho(ORC, 2), 2, 1)).rejects.toThrow(/VERSAO_DIVERGENTE/);
  });

  it("a gerente não gera orçamento de outra pessoa", async () => {
    await expect(gerar(GERENTE, ORC, caminho(ORC, 1), 1, 1)).rejects.toThrow(
      /ORCAMENTO_NAO_EDITAVEL/,
    );
  });

  it("recusa total que não bate com o que o banco calcula (preço mudou no meio)", async () => {
    // O banco congela com os preços atuais: 6 x 40 + 8,5 x 20 + 890 = 240 + 170 + 890 = 1300
    await expect(gerar(ALINE, ORC, caminho(ORC, 1), 1, 1265)).rejects.toThrow(/TOTAL_DIVERGENTE/);
    // A transação desfez o congelamento: os preços velhos continuam nos itens.
    expect((await itens(ORC))[0].preco).toBe("37.00");
    const o = await db.query<{ status: string; pdf_versao: number }>(
      "select status, pdf_versao from orcamentos where id = $1",
      [ORC],
    );
    expect(o.rows[0]).toEqual({ status: "rascunho", pdf_versao: 0 });
  });

  it("recusa avulso sem preço e produto inativo", async () => {
    await db.exec(`insert into orcamento_itens (id, orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem)
      values ('00000000-0000-0000-0000-0000000000f1', '${ORC}', null, 'Avulso sem preço', 0, 1, 'Sala', true, 9)`);
    await expect(gerar(ALINE, ORC, caminho(ORC, 1), 1, 1300)).rejects.toThrow(/AVULSO_SEM_PRECO/);
    await db.exec(`delete from orcamento_itens where id = '00000000-0000-0000-0000-0000000000f1'`);

    await db.exec(`insert into orcamento_itens (id, orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem)
      values ('00000000-0000-0000-0000-0000000000f2', '${ORC}', '7777', 'Desativado', 10, 1, 'Sala', false, 9)`);
    await expect(gerar(ALINE, ORC, caminho(ORC, 1), 1, 1310)).rejects.toThrow(/PRODUTO_INATIVO/);
    await db.exec(`delete from orcamento_itens where id = '00000000-0000-0000-0000-0000000000f2'`);
  });

  it("congela preço e descrição do catálogo, marca como gerado e guarda o PDF e a validade", async () => {
    const r = await gerar(ALINE, ORC, caminho(ORC, 1), 1, 1300);
    expect(r.rows[0]).toMatchObject({ r: { valor_total: 1300, pdf_versao: 1 } });

    const itensGerados = await itens(ORC);
    expect(itensGerados.map((i) => [i.codigo, i.preco, i.descricao])).toEqual([
      ["9520", "40.00", "STELLA DIC 6W 2.7K"], // preço e descrição do catálogo
      ["12222", "20.00", "MTS FITA 22W/M NT NIT"],
      [null, "890.00", "Pendente sob medida"], // avulso mantém o preço manual
    ]);

    const o = await db.query<{
      status: string;
      valor_total: string;
      validade: string;
      pdf_caminho: string;
      pdf_versao: number;
      gerado_em: string | null;
      pdf_versoes: { versao: number }[];
    }>(
      "select status, valor_total, validade::text, pdf_caminho, pdf_versao, gerado_em, pdf_versoes from orcamentos where id = $1",
      [ORC],
    );
    expect(o.rows[0]).toMatchObject({
      status: "gerado",
      pdf_caminho: caminho(ORC, 1),
      pdf_versao: 1,
      validade: "2026-11-13",
    });
    expect(Number(o.rows[0].valor_total)).toBe(1300);
    expect(o.rows[0].gerado_em).not.toBeNull();
    expect(o.rows[0].pdf_versoes.map((v) => v.versao)).toEqual([1]);

    const eventos = await db.query<{ de_status: string | null; para_status: string }>(
      "select de_status, para_status from eventos where orcamento_id = $1 order by id",
      [ORC],
    );
    expect(eventos.rows.at(-1)).toEqual({ de_status: "rascunho", para_status: "gerado" });
  });

  it("os preços ficam congelados: mudar o catálogo depois não altera o orçamento gerado", async () => {
    await db.exec("update produtos set preco_unitario = 99 where codigo = '9520'");
    expect((await itens(ORC))[0].preco).toBe("40.00");
    await db.exec("update produtos set preco_unitario = 40 where codigo = '9520'");
  });

  it("gera uma nova versão (2) sem apagar a anterior e mantém status gerado", async () => {
    await comoUsuario(
      db,
      ALINE,
      "update orcamento_itens set quantidade = 8 where orcamento_id = $1 and codigo = '9520'",
      [ORC],
    );
    // 8 x 40 + 170 + 890 = 1380
    const r = await gerar(ALINE, ORC, caminho(ORC, 2), 2, 1380);
    expect(r.rows[0]).toMatchObject({ r: { pdf_versao: 2 } });
    const o = await db.query<{
      pdf_versoes: { versao: number; caminho: string }[];
      pdf_caminho: string;
      status: string;
    }>("select pdf_versoes, pdf_caminho, status from orcamentos where id = $1", [ORC]);
    expect(o.rows[0].status).toBe("gerado");
    expect(o.rows[0].pdf_caminho).toBe(caminho(ORC, 2));
    expect(o.rows[0].pdf_versoes.map((v) => v.versao)).toEqual([1, 2]);
    // Repetir a mesma versão é recusado (alguém gerou antes).
    await expect(gerar(ALINE, ORC, caminho(ORC, 2), 2, 1380)).rejects.toThrow(/VERSAO_DIVERGENTE/);
  });
});

describe("configuracoes_loja", () => {
  it("vem com os dados iniciais e sem inventar contatos", async () => {
    const r = await db.query<Record<string, string | number | null>>(
      "select * from configuracoes_loja",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      nome_fantasia: "Luz Design",
      razao_social: "Luz Design LTDA",
      cnpj: "04.487.554/0001-16",
      endereco: "Av. Dr. Júlio Marques Luz, 753-C, Jatiúca, Maceió-AL",
      telefone: null,
      whatsapp: null,
      instagram: null,
      site: null,
      validade_dias: 7,
    });
    expect(Number(r.rows[0].desconto_avista_pct)).toBe(10);
    expect(String(r.rows[0].linhas_rodape).split("\n")).toEqual([
      "À vista, desconto de 10%",
      "Orçamento válido por 7 dias",
      "Prazo de entrega: 30 a 45 dias úteis após o pagamento",
      "Não fazemos trocas de peças por encomenda",
      "Mercadoria frágil",
    ]);
  });

  it("todos os logados leem; só a gerente edita; não há segunda linha", async () => {
    expect((await comoUsuario(db, ALINE, "select id from configuracoes_loja")).rows).toHaveLength(
      1,
    );

    const vendedora = await comoUsuario(
      db,
      ALINE,
      "update configuracoes_loja set telefone = 'x' returning id",
    );
    expect(vendedora.rows).toEqual([]);

    const gerente = await comoUsuario(
      db,
      GERENTE,
      "update configuracoes_loja set telefone = '(82) 3000-0000' returning telefone",
    );
    expect(gerente.rows).toEqual([{ telefone: "(82) 3000-0000" }]);

    await expect(
      comoUsuario(
        db,
        GERENTE,
        "insert into configuracoes_loja (id, nome_fantasia) values (false, 'Outra')",
      ),
    ).rejects.toThrow();
    await expect(
      comoUsuario(
        db,
        GERENTE,
        "insert into configuracoes_loja (id, nome_fantasia) values (true, 'Outra')",
      ),
    ).rejects.toThrow();
  });

  it("valida validade e desconto", async () => {
    await expect(
      comoUsuario(db, GERENTE, "update configuracoes_loja set validade_dias = 0"),
    ).rejects.toThrow();
    await expect(
      comoUsuario(db, GERENTE, "update configuracoes_loja set desconto_avista_pct = 101"),
    ).rejects.toThrow();
  });
});
