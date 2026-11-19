/* eslint-disable @typescript-eslint/no-explicit-any -- JSON das funções SQL */
// Dia 13B no Postgres local (PGlite): a marca de piloto (gatilho, view, gerência) e a passagem
// para as contas reais (transferir_piloto).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const ALINE_REAL = "00000000-0000-0000-0000-0000000000a1";
const CLI_PILOTO = "00000000-0000-0000-0000-0000000000c1";
const CLI_TESTE = "00000000-0000-0000-0000-0000000000c2";
const CLI_TESTE_NOME = "00000000-0000-0000-0000-0000000000c3";
const CLI_MISTO = "00000000-0000-0000-0000-0000000000c4";
let db: PGlite;

async function criar(id: string, vendedora: string, cliente: string, extra = "") {
  await db.exec(
    `insert into orcamentos (id, vendedora_id, cliente_id, valor_total ${extra ? ", " + extra.split("=")[0] : ""})
     values ('${id}', '${vendedora}', '${cliente}', 100 ${extra ? ", " + extra.split("=")[1] : ""})`,
  );
}
const piloto = async (id: string) =>
  (await db.query<{ piloto: boolean }>(`select piloto from orcamentos where id = '${id}'`)).rows[0]
    .piloto;

beforeAll(async () => {
  db = await criarBancoLocal();
  // A marca automática depende da data (piloto_inicio); os testes não podem depender do relógio.
  await db.exec("update configuracoes_loja set piloto_inicio = now() + interval '1 year'");
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}'), ('${ALINE_REAL}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'caiolyra.up+aline@gmail.com', 'vendedora'),
      ('${KELY}', 'Kely', 'caiolyra.up+kely@gmail.com', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'caiolyra.up+gerencia@gmail.com', 'gerente'),
      ('${ALINE_REAL}', 'Aline real', 'aline@luzdesign.com.br', 'vendedora');
    insert into clientes (id, vendedora_id, nome) values
      ('${CLI_PILOTO}', '${ALINE}', 'Maria da Silva'),
      ('${CLI_TESTE}', '${ALINE}', 'TESTE Cliente A'),
      ('${CLI_TESTE_NOME}', '${KELY}', 'Teste do piloto'),
      ('${CLI_MISTO}', '${ALINE}', 'Cliente misto');
  `);
}, 60_000);

// comoUsuario deixa o 'login' gravado na sessão; cada teste começa como servidor (sem login).
beforeEach(async () => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)");
});

afterAll(async () => {
  await db.close();
});

describe("marca automática do piloto", () => {
  it("antes do início do piloto, orçamento de conta de teste NÃO é piloto", async () => {
    await criar("10000000-0000-0000-0000-000000000001", ALINE, CLI_MISTO);
    expect(await piloto("10000000-0000-0000-0000-000000000001")).toBe(false);
  });

  it("depois do início, é piloto para a Aline e para a Kely, e não para outras contas", async () => {
    await db.exec("update configuracoes_loja set piloto_inicio = now() - interval '1 hour'");
    await criar("10000000-0000-0000-0000-000000000002", ALINE, CLI_PILOTO);
    await criar("10000000-0000-0000-0000-000000000003", KELY, CLI_TESTE_NOME);
    await criar("10000000-0000-0000-0000-000000000004", ALINE_REAL, CLI_PILOTO);
    expect(await piloto("10000000-0000-0000-0000-000000000002")).toBe(true);
    expect(await piloto("10000000-0000-0000-0000-000000000003")).toBe(true);
    expect(await piloto("10000000-0000-0000-0000-000000000004")).toBe(false);
  });

  it("a vendedora não muda a marca (nem a própria); a gerência marca e desmarca", async () => {
    const id = "10000000-0000-0000-0000-000000000002";
    await expect(
      comoUsuario(db, ALINE, `update orcamentos set piloto = false where id = '${id}'`),
    ).rejects.toThrow(/gerência/);
    await expect(comoUsuario(db, ALINE, `select marcar_piloto('${id}', false)`)).rejects.toThrow(
      /gerência/,
    );
    expect(await piloto(id)).toBe(true);
    await comoUsuario(db, GERENTE, `select marcar_piloto('${id}', false)`);
    expect(await piloto(id)).toBe(false);
    await comoUsuario(db, GERENTE, `select marcar_piloto('${id}', true)`);
    expect(await piloto(id)).toBe(true);
  });

  it("a vendedora segue editando o orçamento piloto normalmente", async () => {
    const id = "10000000-0000-0000-0000-000000000002";
    await comoUsuario(db, ALINE, `update orcamentos set valor_total = 250 where id = '${id}'`);
    expect(await piloto(id)).toBe(true);
  });
});

describe("piloto entra nos números; o seed de teste continua fora", () => {
  it("cliente com nome 'Teste…' de orçamento piloto conta; o mesmo fora do piloto não", async () => {
    await criar("10000000-0000-0000-0000-000000000005", ALINE, CLI_TESTE); // piloto (depois do início)
    await db.exec(
      "update orcamentos set piloto = false where id = '10000000-0000-0000-0000-000000000005'",
    );
    const fora = await comoUsuario<{ id: string }>(db, GERENTE, "select id from orcamentos_reais");
    const ids = fora.rows.map((r) => r.id);
    expect(ids).not.toContain("10000000-0000-0000-0000-000000000005"); // TESTE seed: fora
    expect(ids).toContain("10000000-0000-0000-0000-000000000003"); // piloto, mesmo "Teste do piloto"
    expect(ids).toContain("10000000-0000-0000-0000-000000000002");
  });

  it("(os de cliente real anteriores ao piloto também contam, como sempre)", async () => {
    const r = await comoUsuario<{ id: string }>(db, GERENTE, "select id from orcamentos_reais");
    expect(r.rows.map((x) => x.id)).toContain("10000000-0000-0000-0000-000000000001");
  });

  it("listar_orcamentos sem incluir_teste traz o piloto e esconde o seed de teste", async () => {
    const r = await comoUsuario<{ r: any }>(
      db,
      GERENTE,
      `select listar_orcamentos('{"limite":50,"status":[],"incluir_teste":false}'::jsonb) as r`,
    );
    const ids = r.rows[0].r.itens.map((i: any) => i.id);
    expect(ids).toContain("10000000-0000-0000-0000-000000000003");
    expect(ids).not.toContain("10000000-0000-0000-0000-000000000005");
  });
});

describe("transferir_piloto", () => {
  const O1 = "10000000-0000-0000-0000-000000000002";

  beforeAll(async () => {
    await db.exec(`
      update orcamentos set pdf_caminho = '${ALINE}/${O1}/2026-0002-v1.pdf',
                            xlsx_caminho = '${ALINE}/${O1}/2026-0002-v1.xlsx' where id = '${O1}';
      insert into anexos (orcamento_id, caminho_storage, tipo) values ('${O1}', '${ALINE}/${O1}/foto.jpg', 'foto');
      insert into orcamento_itens (orcamento_id, descricao_congelada, preco_unitario_congelado, quantidade, avulso)
        values ('${O1}', 'Item avulso', 10, 1, true);
      insert into eventos (orcamento_id, usuario_id, para_status) values ('${O1}', '${ALINE}', 'rascunho');
      insert into uso_ia (orcamento_id, vendedora_id) values ('${O1}', '${ALINE}');
    `);
  });

  it("só o servidor executa: a gerência e a vendedora não", async () => {
    for (const quem of [GERENTE, ALINE]) {
      await expect(
        comoUsuario(db, quem, `select transferir_piloto('${ALINE}', '${ALINE_REAL}', false)`),
      ).rejects.toThrow();
    }
  });

  it("recusa mesma conta, origem/destino que não é vendedora", async () => {
    await expect(db.query(`select transferir_piloto('${ALINE}', '${ALINE}')`)).rejects.toThrow(
      /mesma/,
    );
    await expect(db.query(`select transferir_piloto('${ALINE}', '${GERENTE}')`)).rejects.toThrow(
      /destino/,
    );
  });

  it("simular só conta: não muda nada e informa os arquivos que seriam movidos", async () => {
    const r = (
      await db.query<{ r: any }>(
        `select transferir_piloto('${ALINE}', '${ALINE_REAL}', false) as r`,
      )
    ).rows[0].r;
    expect(r.executado).toBe(false);
    expect(r.antes.orcamentos).toBe(1);
    expect(r.antes.clientes).toBe(1);
    expect(r.antes.itens).toBe(1);
    expect(r.antes.anexos).toBe(1);
    expect(r.antes.eventos).toBe(1);
    expect(r.antes.uso_ia).toBe(1);
    expect(r.depois.orcamentos_na_conta_destino).toBe(0);
    expect(r.arquivos).toHaveLength(3);
    const dono = await db.query<{ vendedora_id: string }>(
      `select vendedora_id from orcamentos where id = '${O1}'`,
    );
    expect(dono.rows[0].vendedora_id).toBe(ALINE);
  });

  it("recusa quando o cliente do piloto também tem orçamento de teste (não parte o cliente)", async () => {
    await criar("10000000-0000-0000-0000-000000000006", ALINE, CLI_PILOTO);
    await db.exec(
      "update orcamentos set piloto = false where id = '10000000-0000-0000-0000-000000000006'",
    );
    await expect(
      db.query(`select transferir_piloto('${ALINE}', '${ALINE_REAL}', true)`),
    ).rejects.toThrow(/ao mesmo tempo/);
    const dono = await db.query<{ vendedora_id: string }>(
      `select vendedora_id from orcamentos where id = '${O1}'`,
    );
    expect(dono.rows[0].vendedora_id).toBe(ALINE); // nada mudou
    await db.exec("delete from orcamentos where id = '10000000-0000-0000-0000-000000000006'");
  });

  it("executar move orçamento, cliente, itens, anexos, eventos, IA e caminhos; o resto fica", async () => {
    const r = (
      await db.query<{ r: any }>(`select transferir_piloto('${ALINE}', '${ALINE_REAL}', true) as r`)
    ).rows[0].r;
    expect(r.executado).toBe(true);
    expect(r.depois.orcamentos_na_conta_destino).toBe(r.antes.orcamentos);
    expect(r.depois.clientes_na_conta_destino).toBe(r.antes.clientes);
    expect(r.depois.anexos_no_caminho_destino).toBe(r.antes.anexos);
    expect(r.depois.eventos_na_conta_destino).toBe(r.antes.eventos);
    expect(r.depois.origem_orcamentos_piloto).toBe(0);
    expect(r.depois.destino_orcamentos).toBe(r.antes.destino_orcamentos + r.antes.orcamentos);

    const o = (
      await db.query<any>(
        `select vendedora_id, pdf_caminho, xlsx_caminho, piloto from orcamentos where id = '${O1}'`,
      )
    ).rows[0];
    expect(o.vendedora_id).toBe(ALINE_REAL);
    expect(o.pdf_caminho).toBe(`${ALINE_REAL}/${O1}/2026-0002-v1.pdf`);
    expect(o.xlsx_caminho).toBe(`${ALINE_REAL}/${O1}/2026-0002-v1.xlsx`);
    expect(o.piloto).toBe(true);
    const a = await db.query<any>(
      `select caminho_storage from anexos where orcamento_id = '${O1}'`,
    );
    expect(a.rows[0].caminho_storage).toBe(`${ALINE_REAL}/${O1}/foto.jpg`);
    const c = await db.query<any>(`select vendedora_id from clientes where id = '${CLI_PILOTO}'`);
    expect(c.rows[0].vendedora_id).toBe(ALINE_REAL);
    // o que não era do piloto continua com a conta de teste
    const teste = await db.query<any>(
      `select vendedora_id from clientes where id = '${CLI_TESTE}'`,
    );
    expect(teste.rows[0].vendedora_id).toBe(ALINE);
    // a nova dona enxerga o orçamento por RLS; a conta de teste já não
    const dela = await comoUsuario<any>(
      db,
      ALINE_REAL,
      `select id from orcamentos where id = '${O1}'`,
    );
    const antiga = await comoUsuario<any>(
      db,
      ALINE,
      `select id from orcamentos where id = '${O1}'`,
    );
    expect(dela.rows).toHaveLength(1);
    expect(antiga.rows).toHaveLength(0);
  });
});
