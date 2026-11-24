/* eslint-disable @typescript-eslint/no-explicit-any -- JSON das funções SQL */
// Dia 11D no Postgres local (PGlite): comissões só para o dono, cálculo no fechamento, percentual
// congelado, reabertura e teste fora.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const DONO = "00000000-0000-0000-0000-00000000000d";
const ARQ = "00000000-0000-0000-0000-0000000000a1";
const cli = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const orc = (n: number) => `00000000-0000-0000-0000-00000000${String(6000 + n)}`;

let db: PGlite;

async function novoOrcamento(
  n: number,
  opcoes: { arquiteto?: boolean; teste?: boolean; valor?: number } = {},
) {
  await db.exec(`
    insert into clientes (id, vendedora_id, nome) values ('${cli(n)}', '${ALINE}', 'Cliente ${n}');
    insert into orcamentos (id, vendedora_id, cliente_id, valor_total, arquiteto_id, respostas)
    values ('${orc(n)}', '${ALINE}', '${cli(n)}', ${opcoes.valor ?? 1000},
            ${opcoes.arquiteto === false ? "null" : `'${ARQ}'`},
            '${opcoes.teste ? '{"teste": true}' : "{}"}'::jsonb);
    update orcamentos set status = 'gerado' where id = '${orc(n)}';
  `);
}
const fechar = (n: number, valor?: number) =>
  comoUsuario(db, ALINE, "select mudar_status_orcamento($1, 'fechado', $2, null, current_date)", [
    orc(n),
    valor ?? null,
  ]);
const linhas = (n: number) =>
  db
    .query<any>(
      "select tipo, percentual::float as percentual, valor::float as valor, base::float as base, status, revisar from comissoes where orcamento_id = $1 order by tipo",
      [orc(n)],
    )
    .then((r) => r.rows);
const config = (sql: string) => db.exec(`update configuracoes_comissao set ${sql}`);

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${GERENTE}'), ('${DONO}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente'),
      ('${DONO}', 'Seu Filipe', 'd@x', 'dono');
    insert into arquitetos (id, nome, criado_por) values ('${ARQ}', 'Arq Teste', '${GERENTE}');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("perfis", () => {
  it("o dono faz o que a gerência faz (eh_gerente) e é o único eh_dono", async () => {
    const f = (u: string) =>
      comoUsuario<{ g: boolean; d: boolean }>(
        db,
        u,
        "select eh_gerente() as g, eh_dono() as d",
      ).then((r) => r.rows[0]);
    expect(await f(ALINE)).toEqual({ g: false, d: false });
    expect(await f(GERENTE)).toEqual({ g: true, d: false });
    expect(await f(DONO)).toEqual({ g: true, d: true });
  });
});

describe("RLS: só o dono vê comissões", () => {
  it("vendedora e gerente não leem nenhuma das tabelas", async () => {
    for (const t of [
      "comissoes",
      "configuracoes_comissao",
      "comissoes_arquiteto_percentual",
      "comissoes_vendedora_percentual",
    ]) {
      for (const u of [ALINE, GERENTE]) {
        const r = await comoUsuario(db, u, `select * from ${t}`);
        expect(r.rows, `${t} para ${u}`).toHaveLength(0);
      }
    }
    const dono = await comoUsuario(db, DONO, "select * from configuracoes_comissao");
    expect(dono.rows).toHaveLength(1);
  });

  it("a gerente não escreve nas configurações nem chama as funções do dono", async () => {
    const e = await comoUsuario(
      db,
      GERENTE,
      "update configuracoes_comissao set percentual_arquiteto_padrao = 5 returning id",
    );
    expect(e.rows).toHaveLength(0);
    await expect(
      comoUsuario(db, GERENTE, "select calcular_fechamentos_anteriores(false)"),
    ).rejects.toThrow(/SEM_PERMISSAO/);
    await expect(
      comoUsuario(db, ALINE, "select * from comissao_linhas($1)", [orc(1)]),
    ).rejects.toThrow();
  });
});

describe("cálculo no fechamento", () => {
  it("percentuais vazios: nada é calculado", async () => {
    await novoOrcamento(1);
    await fechar(1);
    expect(await linhas(1)).toEqual([]);
  });

  it("com percentuais: uma linha por beneficiário, e a vendedora que fecha não lê nada", async () => {
    await config("percentual_arquiteto_padrao = 5, percentual_vendedora_padrao = 3");
    await novoOrcamento(2, { valor: 1000 });
    await fechar(2, 1200);
    expect(await linhas(2)).toEqual([
      {
        tipo: "arquiteto",
        percentual: 5,
        valor: 60,
        base: 1200,
        status: "a_pagar",
        revisar: false,
      },
      {
        tipo: "vendedora",
        percentual: 3,
        valor: 36,
        base: 1200,
        status: "a_pagar",
        revisar: false,
      },
    ]);
    const aline = await comoUsuario(db, ALINE, "select * from comissoes");
    expect(aline.rows).toHaveLength(0);
    const dono = await comoUsuario(db, DONO, "select * from comissoes where orcamento_id = $1", [
      orc(2),
    ]);
    expect(dono.rows).toHaveLength(2);
  });

  it("a base é o valor FECHADO (não o total)", async () => {
    await novoOrcamento(3, { valor: 5000 });
    await fechar(3, 4500);
    expect((await linhas(3)).map((l) => l.base)).toEqual([4500, 4500]);
  });

  it("mudar o percentual depois não altera o que já foi calculado; Recalcular altera (só a pagar)", async () => {
    await config("percentual_arquiteto_padrao = 8");
    expect((await linhas(2))[0]).toMatchObject({ percentual: 5, valor: 60 });
    const id = (
      await db.query<{ id: string }>(
        "select id from comissoes where orcamento_id = $1 and tipo = 'arquiteto'",
        [orc(2)],
      )
    ).rows[0].id;
    const r = await comoUsuario<{ r: any }>(db, DONO, "select recalcular_comissao($1) as r", [id]);
    expect(r.rows[0].r).toMatchObject({ percentual: 8, valor: 96 });
    await db.exec(
      `update comissoes set status = 'paga', paga_em = current_date where id = '${id}'`,
    );
    await expect(comoUsuario(db, DONO, "select recalcular_comissao($1)", [id])).rejects.toThrow(
      /SO_A_PAGAR/,
    );
    await config("percentual_arquiteto_padrao = 5");
  });

  it("sem arquiteto só gera a da vendedora; regra própria de venda com arquiteto", async () => {
    await novoOrcamento(4, { arquiteto: false });
    await fechar(4);
    expect((await linhas(4)).map((l) => l.tipo)).toEqual(["vendedora"]);
    await config("percentual_vendedora_com_arquiteto = 2");
    await novoOrcamento(5);
    await fechar(5);
    expect((await linhas(5)).find((l) => l.tipo === "vendedora")).toMatchObject({ percentual: 2 });
    await config("percentual_vendedora_com_arquiteto = null");
  });

  it("percentual próprio do arquiteto e da vendedora vale sobre o padrão", async () => {
    await db.exec(`
      insert into comissoes_arquiteto_percentual (arquiteto_id, percentual) values ('${ARQ}', 10);
      insert into comissoes_vendedora_percentual (vendedora_id, percentual) values ('${ALINE}', 4);
    `);
    await novoOrcamento(6, { valor: 200 });
    await fechar(6);
    expect(await linhas(6)).toMatchObject([
      { tipo: "arquiteto", percentual: 10, valor: 20 },
      { tipo: "vendedora", percentual: 4, valor: 8 },
    ]);
    await db.exec(
      "delete from comissoes_arquiteto_percentual; delete from comissoes_vendedora_percentual",
    );
  });

  it("arredondamento comercial em 2 casas", async () => {
    await config("percentual_arquiteto_padrao = 3.33, percentual_vendedora_padrao = 1.5");
    await novoOrcamento(7, { valor: 100.05 });
    await fechar(7);
    expect((await linhas(7)).map((l) => l.valor)).toEqual([3.33, 1.5]); // 3,331665 e 1,50075
  });

  it("orçamento de teste não gera comissão", async () => {
    await novoOrcamento(8, { teste: true });
    await fechar(8);
    expect(await linhas(8)).toEqual([]);
  });
});

describe("reabrir e corrigir fechamento", () => {
  it("cancela as a pagar e preserva as pagas marcando revisão", async () => {
    await config("percentual_arquiteto_padrao = 5, percentual_vendedora_padrao = 3");
    await novoOrcamento(10);
    await fechar(10);
    await db.exec(
      `update comissoes set status = 'paga', paga_em = current_date where orcamento_id = '${orc(10)}' and tipo = 'arquiteto'`,
    );
    // "Corrigir": fechado volta para enviado
    await comoUsuario(db, ALINE, "select mudar_status_orcamento($1, 'enviado')", [orc(10)]);
    const r = await linhas(10);
    expect(r.find((l) => l.tipo === "vendedora")).toMatchObject({ status: "cancelada" });
    expect(r.find((l) => l.tipo === "arquiteto")).toMatchObject({ status: "paga", revisar: true });
  });

  it("fechar de novo reaproveita a linha cancelada e não duplica a paga", async () => {
    await comoUsuario(db, ALINE, "select mudar_status_orcamento($1, 'fechado', 900)", [orc(10)]);
    const r = await linhas(10);
    expect(r).toHaveLength(2);
    expect(r.find((l) => l.tipo === "vendedora")).toMatchObject({
      status: "a_pagar",
      base: 900,
      valor: 27,
    });
    expect(r.find((l) => l.tipo === "arquiteto")).toMatchObject({ status: "paga", revisar: true });
  });
});

describe("fechamentos anteriores", () => {
  it("prévia não grava; gravar cria só o que falta", async () => {
    await db.exec(`delete from comissoes where orcamento_id = '${orc(3)}'`);
    const previa = await comoUsuario<{ r: any }>(
      db,
      DONO,
      "select calcular_fechamentos_anteriores(false) as r",
    );
    expect(previa.rows[0].r.gravado).toBe(false);
    expect(previa.rows[0].r.linhas).toBeGreaterThan(0);
    expect(await linhas(3)).toEqual([]);
    const gravou = await comoUsuario<{ r: any }>(
      db,
      DONO,
      "select calcular_fechamentos_anteriores(true) as r",
    );
    expect(gravou.rows[0].r.gravado).toBe(true);
    expect(await linhas(3)).toHaveLength(2);
  });
});
