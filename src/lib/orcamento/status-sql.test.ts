// Testa mudar_status_orcamento num Postgres local (PGlite) com as migrations reais.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const CLI = "00000000-0000-0000-0000-0000000000c1";
const ORC = "00000000-0000-0000-0000-0000000000a1";
const RASC = "00000000-0000-0000-0000-0000000000a2";

let db: PGlite;

const mudar = (
  quem: string,
  orc: string,
  para: string,
  valor: number | null = null,
  motivo: string | null = null,
) =>
  comoUsuario(
    db,
    quem,
    "select mudar_status_orcamento($1, $2::status_orcamento, $3, $4::motivo_perda) as r",
    [orc, para, valor, motivo],
  );

async function estado(orc = ORC) {
  const r = await db.query<{
    status: string;
    valor_fechado: string | null;
    motivo_perda: string | null;
    enviado_em: string | null;
    fechado_em: string | null;
    perdido_em: string | null;
  }>(
    "select status, valor_fechado, motivo_perda, enviado_em, fechado_em, perdido_em from orcamentos where id = $1",
    [orc],
  );
  return r.rows[0];
}

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into clientes (id, vendedora_id, nome) values ('${CLI}', '${ALINE}', 'TESTE');
    insert into orcamentos (id, vendedora_id, cliente_id, status, valor_total) values
      ('${ORC}', '${ALINE}', '${CLI}', 'gerado', 1300),
      ('${RASC}', '${ALINE}', '${CLI}', 'rascunho', 0);
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("mudar_status_orcamento", () => {
  it("rascunho não muda por aqui (só gerando o PDF)", async () => {
    await expect(mudar(ALINE, RASC, "enviado")).rejects.toThrow(/TRANSICAO_INVALIDA/);
  });

  it("outra vendedora não muda; a gerente muda e fica registrada nos eventos", async () => {
    await expect(mudar(KELY, ORC, "enviado")).rejects.toThrow(
      /ORCAMENTO_NAO_ENCONTRADO|SEM_PERMISSAO/,
    );
    await mudar(GERENTE, ORC, "enviado");
    expect((await estado()).status).toBe("enviado");
    const ev = await db.query<{ usuario_id: string; de_status: string; para_status: string }>(
      "select usuario_id, de_status, para_status from eventos where orcamento_id = $1 order by id desc limit 1",
      [ORC],
    );
    expect(ev.rows[0]).toEqual({
      usuario_id: GERENTE,
      de_status: "gerado",
      para_status: "enviado",
    });
    expect((await estado()).enviado_em).not.toBeNull();
  });

  it("segue o fluxo: follow-up D+5, D+10, e recusa saltos e o mesmo status", async () => {
    await mudar(ALINE, ORC, "followup_d5");
    await expect(mudar(ALINE, ORC, "followup_d5")).rejects.toThrow(/MESMO_STATUS/);
    await expect(mudar(ALINE, ORC, "rascunho")).rejects.toThrow(/TRANSICAO_INVALIDA/);
    await mudar(ALINE, ORC, "followup_d10");
    expect((await estado()).status).toBe("followup_d10");
    const e = await db.query<{ n: number }>(
      "select count(*)::int n from eventos where orcamento_id = $1 and para_status in ('enviado','followup_d5','followup_d10')",
      [ORC],
    );
    expect(e.rows[0].n).toBe(3);
  });

  it("perder exige o motivo e o registra com a data", async () => {
    await expect(mudar(ALINE, ORC, "perdido")).rejects.toThrow(/MOTIVO_OBRIGATORIO/);
    await mudar(ALINE, ORC, "perdido", null, "preco");
    const s = await estado();
    expect(s).toMatchObject({ status: "perdido", motivo_perda: "preco", valor_fechado: null });
    expect(s.perdido_em).not.toBeNull();
  });

  it("reabrir limpa motivo e data; fechar usa o total por padrão ou o valor negociado", async () => {
    await mudar(ALINE, ORC, "enviado");
    expect(await estado()).toMatchObject({
      status: "enviado",
      motivo_perda: null,
      perdido_em: null,
    });

    await mudar(ALINE, ORC, "fechado");
    let s = await estado();
    expect(s.status).toBe("fechado");
    expect(Number(s.valor_fechado)).toBe(1300);
    expect(s.fechado_em).not.toBeNull();

    await mudar(ALINE, ORC, "enviado");
    await mudar(ALINE, ORC, "fechado", 1100.5);
    s = await estado();
    expect(Number(s.valor_fechado)).toBe(1100.5);
  });

  it("valor da venda precisa ser maior que zero; fechado só reabre", async () => {
    await mudar(ALINE, ORC, "enviado");
    await expect(mudar(ALINE, ORC, "fechado", 0)).rejects.toThrow(/VALOR_INVALIDO/);
    await mudar(ALINE, ORC, "fechado", 900);
    await expect(mudar(ALINE, ORC, "perdido", null, "preco")).rejects.toThrow(/TRANSICAO_INVALIDA/);
  });

  it("voltar para gerado limpa a data de envio", async () => {
    await mudar(ALINE, ORC, "enviado");
    await mudar(ALINE, ORC, "gerado");
    expect((await estado()).enviado_em).toBeNull();
  });
});
