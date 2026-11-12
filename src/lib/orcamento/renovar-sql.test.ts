/* eslint-disable @typescript-eslint/no-explicit-any */
// Dia 10B no Postgres local (PGlite): renovar_validade (preços atualizados ou mantidos, item inativo
// bloqueia, versão nova, evento, permissões) e o que vem depois (marcar enviado recomeça o follow-up).
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const CLI = "00000000-0000-0000-0000-0000000000c1";
const orc = (n: number) => `00000000-0000-0000-0000-00000000${String(4000 + n)}`;

let db: PGlite;

/** Orçamento enviado há 10 dias, gerado (v1) com a fita a R$ 15 (hoje custa R$ 20) e um avulso. */
async function novoVencido(n: number, status = "enviado", vend = ALINE) {
  await db.exec(`
    insert into orcamentos (id, vendedora_id, cliente_id, status) values ('${orc(n)}', '${vend}', '${CLI}', 'rascunho');
    insert into orcamento_itens (orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem) values
      ('${orc(n)}', '9520', 'STELLA', 30, 2, 'Sala', false, 0),
      ('${orc(n)}', '12222', 'FITA', 15, 4, 'Sala', false, 1),
      ('${orc(n)}', null, 'Pendente avulso', 100, 1, 'Sala', true, 2);
    update orcamentos set status = '${status}', pdf_versao = 1, pdf_versoes = '[{"versao":1}]'::jsonb,
           pdf_caminho = '${vend}/${orc(n)}/x-v1.pdf',
           gerado_em = now() - interval '10 days',
           enviado_em = now() - interval '9 days', ultimo_envio_em = now() - interval '9 days',
           validade = hoje_maceio() - 2, valor_total = 2*30 + 4*15 + 100
     where id = '${orc(n)}';
  `);
}

const renovar = (
  usuario: string,
  n: number,
  total: number,
  opcoes: { versao?: number; manter?: boolean; pasta?: string } = {},
) =>
  comoUsuario<{
    r: any;
  }>(db, usuario, "select renovar_validade($1, $2, $3, $4, $5, hoje_maceio() + 7, $6) as r", [
    orc(n),
    `${opcoes.pasta ?? ALINE}/${orc(n)}/x-v${opcoes.versao ?? 2}.pdf`,
    `${opcoes.pasta ?? ALINE}/${orc(n)}/x-v${opcoes.versao ?? 2}.xlsx`,
    opcoes.versao ?? 2,
    total,
    opcoes.manter ?? false,
  ]);

const estado = async (n: number) =>
  (
    await db.query<{
      status: string;
      pdf_versao: number;
      valor_total: string;
      validade_ok: boolean;
      enviado_em: string | null;
      ultimo: string | null;
      versoes: any[];
    }>(
      `select status, pdf_versao, valor_total::text, (validade = hoje_maceio() + 7) as validade_ok,
              enviado_em::text, ultimo_envio_em::text as ultimo, pdf_versoes as versoes
         from orcamentos where id = '${orc(n)}'`,
    )
  ).rows[0];

const precos = async (n: number) =>
  (
    await db.query<{ codigo: string | null; preco: string }>(
      `select codigo, preco_unitario_congelado::text as preco from orcamento_itens where orcamento_id = '${orc(n)}' order by ordem`,
    )
  ).rows.map((r) => Number(r.preco));

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into produtos (codigo, descricao, unidade, preco_unitario) values
      ('9520', 'STELLA', 'un', 40), ('12222', 'FITA', 'm', 20);
    insert into clientes (id, vendedora_id, nome) values ('${CLI}', '${ALINE}', 'Cliente');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("renovar_validade", () => {
  it("atualizando os preços: itens com código vão para o preço do catálogo, avulso fica, versão nova", async () => {
    await novoVencido(1);
    // 2 x 40 + 4 x 20 + 100 = 260
    await renovar(ALINE, 1, 260);
    expect(await precos(1)).toEqual([40, 20, 100]);
    const e = await estado(1);
    expect(e).toMatchObject({
      status: "gerado",
      pdf_versao: 2,
      valor_total: "260.00",
      validade_ok: true,
    });
    expect(e.versoes).toHaveLength(2);
    expect(e.versoes[1]).toMatchObject({ versao: 2, renovada: true, manteve_precos: false });
  });

  it("mantendo os preços antigos: nada muda nos itens", async () => {
    await novoVencido(2);
    // 2 x 30 + 4 x 15 + 100 = 220
    await renovar(ALINE, 2, 220, { manter: true });
    expect(await precos(2)).toEqual([30, 15, 100]);
    const e = await estado(2);
    expect(e).toMatchObject({
      status: "gerado",
      pdf_versao: 2,
      valor_total: "220.00",
      validade_ok: true,
    });
    expect(e.versoes[1]).toMatchObject({ renovada: true, manteve_precos: true });
  });

  it("não apaga as datas de envio (o primeiro envio e o último continuam)", async () => {
    await novoVencido(3);
    const antes = await estado(3);
    await renovar(ALINE, 3, 260);
    const depois = await estado(3);
    expect(depois.enviado_em).toBe(antes.enviado_em);
    expect(depois.ultimo).toBe(antes.ultimo);
  });

  it("registra o evento de status (enviado -> gerado) e a versão como renovação", async () => {
    await novoVencido(4, "followup_d5");
    await renovar(ALINE, 4, 260);
    const { rows } = await db.query<{ de_status: string; para_status: string }>(
      `select de_status, para_status from eventos where orcamento_id = '${orc(4)}' order by id desc limit 1`,
    );
    expect(rows[0]).toEqual({ de_status: "followup_d5", para_status: "gerado" });
  });

  it("total divergente desfaz tudo (preços, status e versão)", async () => {
    await novoVencido(5);
    await expect(renovar(ALINE, 5, 999)).rejects.toThrow("TOTAL_DIVERGENTE");
    expect(await precos(5)).toEqual([30, 15, 100]);
    expect(await estado(5)).toMatchObject({ status: "enviado", pdf_versao: 1 });
  });

  it("item inativo no catálogo bloqueia (nada muda)", async () => {
    await novoVencido(6);
    await db.exec("update produtos set ativo = false where codigo = '12222'");
    await expect(renovar(ALINE, 6, 260)).rejects.toThrow("PRODUTO_INATIVO");
    await expect(renovar(ALINE, 6, 220, { manter: true })).rejects.toThrow("PRODUTO_INATIVO");
    expect(await estado(6)).toMatchObject({ status: "enviado", pdf_versao: 1 });
    await db.exec("update produtos set ativo = true where codigo = '12222'");
  });

  it("a gerente renova o orçamento de outra; outra vendedora não", async () => {
    await novoVencido(7);
    await expect(renovar(KELY, 7, 260)).rejects.toThrow("SEM_PERMISSAO");
    expect(await estado(7)).toMatchObject({ status: "enviado", pdf_versao: 1 });
    await renovar(GERENTE, 7, 260);
    expect(await estado(7)).toMatchObject({ status: "gerado", pdf_versao: 2 });
  });

  it("sem login não renova", async () => {
    await novoVencido(8);
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)");
    await expect(
      db.query("select renovar_validade($1, $2, null, 2, 260, hoje_maceio() + 7, false)", [
        orc(8),
        `${ALINE}/${orc(8)}/x-v2.pdf`,
      ]),
    ).rejects.toThrow("SEM_PERMISSAO");
  });

  it("só gerado, enviado e follow-ups renovam (fechado e perdido não)", async () => {
    for (const [n, status] of [
      [9, "fechado"],
      [10, "perdido"],
    ] as const) {
      await novoVencido(n, "enviado");
      await db.exec(
        `update orcamentos set status = '${status}', ${status === "perdido" ? "motivo_perda = 'preco'," : "valor_fechado = 260,"} validade = hoje_maceio() - 5 where id = '${orc(n)}'`,
      );
      await expect(renovar(ALINE, n, 260)).rejects.toThrow("ORCAMENTO_NAO_RENOVAVEL");
    }
  });

  it("um orçamento gerado e vencido também renova", async () => {
    await novoVencido(11, "gerado");
    await renovar(ALINE, 11, 260);
    expect(await estado(11)).toMatchObject({ status: "gerado", pdf_versao: 2, validade_ok: true });
  });

  it("versão repetida e caminho fora da pasta da dona são recusados", async () => {
    await novoVencido(12);
    await expect(renovar(ALINE, 12, 260, { versao: 3 })).rejects.toThrow("VERSAO_DIVERGENTE");
    await expect(renovar(ALINE, 12, 260, { pasta: KELY })).rejects.toThrow("CAMINHO_INVALIDO");
    expect(await estado(12)).toMatchObject({ status: "enviado", pdf_versao: 1 });
  });

  it("depois de renovar, marcar como enviado muda só o último envio (o follow-up recomeça dali)", async () => {
    await novoVencido(13);
    const antes = await estado(13);
    await renovar(ALINE, 13, 260);
    await comoUsuario(db, ALINE, "select marcar_enviado($1, null)", [orc(13)]);
    const depois = await estado(13);
    expect(depois.status).toBe("enviado");
    expect(depois.enviado_em).toBe(antes.enviado_em); // o primeiro envio continua o mesmo
    expect(new Date(depois.ultimo!).getTime()).toBeGreaterThan(new Date(antes.ultimo!).getTime());
  });

  it("a edição de itens continua bloqueada depois de enviado de novo", async () => {
    await novoVencido(14);
    await renovar(ALINE, 14, 260);
    await comoUsuario(db, ALINE, "select marcar_enviado($1, null)", [orc(14)]);
    await expect(
      db.exec(`update orcamento_itens set quantidade = 9 where orcamento_id = '${orc(14)}'`),
    ).rejects.toThrow("EDICAO_BLOQUEADA");
  });
});
