// Dia 8A no Postgres local (PGlite): origem do item, Indicação da IA (RLS), descrição padronizada
// (só o servidor grava), uso_ia e a planilha guardada junto do PDF em gerar_orcamento.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const ORC_A = "00000000-0000-0000-0000-0000000000a1";
const ORC_K = "00000000-0000-0000-0000-0000000000b1";

let db: PGlite;

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into produtos (codigo, descricao, unidade, preco_unitario) values
      ('9520', 'STELLA DIC 6W 2.7K', 'un', 40);
    insert into clientes (id, vendedora_id, nome) values
      ('00000000-0000-0000-0000-0000000000c1', '${ALINE}', 'TESTE A'),
      ('00000000-0000-0000-0000-0000000000c2', '${KELY}', 'TESTE K');
    insert into orcamentos (id, vendedora_id, cliente_id, status) values
      ('${ORC_A}', '${ALINE}', '00000000-0000-0000-0000-0000000000c1', 'rascunho'),
      ('${ORC_K}', '${KELY}', '00000000-0000-0000-0000-0000000000c2', 'rascunho');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("origem do item", () => {
  it("padrão manual, aceita as quatro origens e recusa outra", async () => {
    await db.exec(`insert into orcamento_itens (orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem)
      values ('${ORC_A}', '9520', 'X', 40, 1, 'Sala', false, 0)`);
    const r = await db.query<{ origem: string; descricao_manual: boolean }>(
      `select origem, descricao_manual from orcamento_itens where orcamento_id = '${ORC_A}'`,
    );
    expect(r.rows[0]).toEqual({ origem: "manual", descricao_manual: false });

    for (const o of ["lista_colada", "indicacao_ia", "montagem_ia"]) {
      await db.exec(`update orcamento_itens set origem = '${o}' where orcamento_id = '${ORC_A}'`);
    }
    await expect(
      db.exec(`update orcamento_itens set origem = 'telepatia' where orcamento_id = '${ORC_A}'`),
    ).rejects.toThrow();
    await db.exec(`delete from orcamento_itens where orcamento_id = '${ORC_A}'`);
  });
});

describe("uso_ia.tipo", () => {
  it("aceita indicacao e formatacao, e continua recusando tipo desconhecido", async () => {
    for (const t of ["montagem", "reescrever_analise", "indicacao", "formatacao"]) {
      await db.exec(
        `insert into uso_ia (orcamento_id, vendedora_id, status, tipo) values ('${ORC_A}', '${ALINE}', 'ok', '${t}')`,
      );
    }
    await expect(
      db.exec(
        `insert into uso_ia (orcamento_id, vendedora_id, status, tipo) values ('${ORC_A}', '${ALINE}', 'ok', 'x')`,
      ),
    ).rejects.toThrow();
  });
});

describe("indicacoes_ia: RLS como orcamento_itens", () => {
  const nova = (usuario: string, orc: string, ambiente = "Sala") =>
    comoUsuario(
      db,
      usuario,
      `insert into indicacoes_ia (orcamento_id, vendedora_id, ambiente, resposta)
       values ($1, $2, $3, '{"sugestoes":[]}'::jsonb) returning id`,
      [orc, usuario, ambiente],
    );

  it("a dona grava e lê; outra vendedora não lê nem grava no orçamento alheio", async () => {
    expect((await nova(ALINE, ORC_A)).rows).toHaveLength(1);
    await db.exec(`insert into indicacoes_ia (orcamento_id, vendedora_id, ambiente, resposta)
      values ('${ORC_K}', '${KELY}', 'Sala', '{}'::jsonb)`);

    const alinePropria = await comoUsuario(db, ALINE, "select id from indicacoes_ia");
    expect(alinePropria.rows).toHaveLength(1); // só a dela
    await expect(nova(ALINE, ORC_K)).rejects.toThrow(); // no orçamento da Kely
    await expect(nova(KELY, ORC_A)).rejects.toThrow(); // Kely no da Aline
  });

  it("a vendedora não grava como se fosse outra pessoa, nem apaga ou edita a indicação alheia", async () => {
    await expect(
      comoUsuario(
        db,
        ALINE,
        `insert into indicacoes_ia (orcamento_id, vendedora_id, ambiente, resposta) values ($1, $2, 'Sala', '{}'::jsonb)`,
        [ORC_A, KELY],
      ),
    ).rejects.toThrow();
    const edita = await comoUsuario(
      db,
      ALINE,
      `update indicacoes_ia set ambiente = 'X' where orcamento_id = '${ORC_K}' returning id`,
    );
    expect(edita.rows).toHaveLength(0);
    const apaga = await comoUsuario(
      db,
      ALINE,
      `delete from indicacoes_ia where orcamento_id = '${ORC_K}' returning id`,
    );
    expect(apaga.rows).toHaveLength(0);
  });

  it("a gerente lê todas, mas não grava", async () => {
    const todas = await comoUsuario(db, GERENTE, "select id from indicacoes_ia");
    expect(todas.rows.length).toBeGreaterThanOrEqual(2);
    await expect(nova(GERENTE, ORC_A)).rejects.toThrow();
    const edita = await comoUsuario(
      db,
      GERENTE,
      `update indicacoes_ia set ambiente = 'X' returning id`,
    );
    expect(edita.rows).toHaveLength(0);
  });
});

describe("produtos_descricao_formatada: só o servidor grava", () => {
  it("todas as logadas leem; a vendedora e a gerente não gravam; o service role grava", async () => {
    await db.exec(`set role service_role`);
    await db.exec(`insert into produtos_descricao_formatada (codigo, descricao_formatada, descricao_origem, origem_atualizado_em)
      values ('9520', 'Lâmpada dicroica LED 6 W, 2.7 K', 'STELLA DIC 6W 2.7K', now())`);
    await db.exec("reset role");

    const le = await comoUsuario(
      db,
      ALINE,
      "select descricao_formatada from produtos_descricao_formatada",
    );
    expect(le.rows).toEqual([{ descricao_formatada: "Lâmpada dicroica LED 6 W, 2.7 K" }]);

    for (const quem of [ALINE, KELY, GERENTE]) {
      await expect(
        comoUsuario(
          db,
          quem,
          `insert into produtos_descricao_formatada (codigo, descricao_formatada, descricao_origem, origem_atualizado_em) values ('9520', 'x', 'y', now())`,
        ),
      ).rejects.toThrow();
      await expect(
        comoUsuario(
          db,
          quem,
          `update produtos_descricao_formatada set descricao_formatada = 'invadida'`,
        ),
      ).rejects.toThrow();
      await expect(
        comoUsuario(db, quem, `delete from produtos_descricao_formatada`),
      ).rejects.toThrow();
    }
    const intacta = await db.query<{ descricao_formatada: string }>(
      "select descricao_formatada from produtos_descricao_formatada",
    );
    expect(intacta.rows[0].descricao_formatada).toBe("Lâmpada dicroica LED 6 W, 2.7 K");
  });
});

describe("gerar_orcamento com planilha", () => {
  const gerar = (usuario: string, orc: string, pdf: string, xlsx: string | null, versao = 1) =>
    comoUsuario(db, usuario, "select gerar_orcamento($1, $2, $3, $4, $5, $6) as r", [
      orc,
      pdf,
      versao,
      80,
      "2026-11-17",
      xlsx,
    ]);

  it("guarda o caminho do XLSX no orçamento e no histórico de versões; o servidor define a descrição", async () => {
    await db.exec(`insert into orcamento_itens (orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem)
      values ('${ORC_A}', '9520', 'Descrição padronizada pelo servidor', 1, 2, 'Sala', false, 0)`);
    await gerar(
      ALINE,
      ORC_A,
      `${ALINE}/${ORC_A}/2026-0001-v1.pdf`,
      `${ALINE}/${ORC_A}/2026-0001-v1.xlsx`,
    );

    const o = await db.query<{
      xlsx_caminho: string;
      pdf_caminho: string;
      pdf_versoes: { versao: number; xlsx_caminho: string }[];
    }>(`select xlsx_caminho, pdf_caminho, pdf_versoes from orcamentos where id = '${ORC_A}'`);
    expect(o.rows[0].xlsx_caminho).toBe(`${ALINE}/${ORC_A}/2026-0001-v1.xlsx`);
    expect(o.rows[0].pdf_versoes[0]).toMatchObject({
      versao: 1,
      xlsx_caminho: `${ALINE}/${ORC_A}/2026-0001-v1.xlsx`,
    });
    const i = await db.query<{ d: string; p: string }>(
      `select descricao_congelada d, preco_unitario_congelado p from orcamento_itens where orcamento_id = '${ORC_A}'`,
    );
    expect(i.rows[0]).toEqual({ d: "Descrição padronizada pelo servidor", p: "40.00" });
  });

  it("recusa caminho de planilha fora da pasta da dona; sem planilha continua valendo", async () => {
    await expect(
      gerar(ALINE, ORC_A, `${ALINE}/${ORC_A}/2026-0001-v2.pdf`, `${KELY}/${ORC_K}/x.xlsx`, 2),
    ).rejects.toThrow(/CAMINHO_INVALIDO/);
    await gerar(ALINE, ORC_A, `${ALINE}/${ORC_A}/2026-0001-v2.pdf`, null, 2);
    const o = await db.query<{ xlsx_caminho: string | null }>(
      `select xlsx_caminho from orcamentos where id = '${ORC_A}'`,
    );
    expect(o.rows[0].xlsx_caminho).toBeNull();
  });

  it("o bucket de PDFs aceita o tipo da planilha", async () => {
    const b = await db.query<{ allowed_mime_types: string[] }>(
      "select allowed_mime_types from storage.buckets where id = 'pdfs'",
    );
    expect(b.rows[0].allowed_mime_types).toEqual(
      expect.arrayContaining([
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ]),
    );
  });
});
