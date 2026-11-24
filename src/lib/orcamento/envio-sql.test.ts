/* eslint-disable @typescript-eslint/no-explicit-any -- JSON das funções SQL */
// Dia 16 (parte B) no PGlite: a data de envio nunca fica vazia. Fechar ou perder um orçamento "gerado" sem
// envio registrado exige a data (mesmas regras de marcar_enviado); o gatilho é a rede de segurança.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const CLI_A = "c0000000-0000-0000-0000-00000000000a";
const CLI_K = "c0000000-0000-0000-0000-00000000000b";
let db: PGlite;
let n = 0;

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec("update configuracoes_loja set piloto_inicio = now() + interval '1 year'");
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into clientes (id, vendedora_id, nome) values ('${CLI_A}', '${ALINE}', 'Maria'), ('${CLI_K}', '${KELY}', 'Ana');
  `);
}, 60_000);
beforeEach(async () => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)");
});
afterAll(async () => db.close());

/** Orçamento "gerado" criado há `dias` dias (gerado_em ajustado), sem envio registrado. */
async function gerado(dono = ALINE, dias = 3): Promise<string> {
  const id = `b0000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  const cli = dono === ALINE ? CLI_A : CLI_K;
  await db.exec(
    `insert into orcamentos (id, vendedora_id, cliente_id, valor_total) values ('${id}', '${dono}', '${cli}', 500)`,
  );
  await db.exec(`update orcamentos set status = 'gerado' where id = '${id}'`);
  await db.exec(
    `update orcamentos set gerado_em = now() - interval '${dias} days' where id = '${id}'`,
  );
  return id;
}
const linha = async (id: string) =>
  (
    await db.query<any>(
      `select status, enviado_em, ultimo_envio_em, fechado_em, perdido_em from orcamentos where id = '${id}'`,
    )
  ).rows[0];
const hojeMaceio = async () =>
  (await db.query<{ d: string }>("select ((now() at time zone 'America/Maceio')::date)::text d"))
    .rows[0].d;
const diaMaceio = async (ts: Date | string) =>
  (
    await db.query<{ d: string }>(
      `select ((timestamptz '${new Date(ts).toISOString()}' at time zone 'America/Maceio')::date)::text d`,
    )
  ).rows[0].d;

describe("fechar ou perder um orçamento gerado sem envio registrado", () => {
  it("exige a data do envio (fechar e perder)", async () => {
    const id = await gerado();
    await expect(
      comoUsuario(db, ALINE, `select mudar_status_orcamento('${id}', 'fechado', 500)`),
    ).rejects.toThrow(/ENVIO_OBRIGATORIO/);
    await expect(
      comoUsuario(db, ALINE, `select mudar_status_orcamento('${id}', 'perdido', null, 'preco')`),
    ).rejects.toThrow(/ENVIO_OBRIGATORIO/);
    expect((await linha(id)).status).toBe("gerado"); // nada mudou
  });

  it("com a data de hoje grava o envio agora, junto do fechamento", async () => {
    const id = await gerado();
    const hoje = await hojeMaceio();
    await comoUsuario(
      db,
      ALINE,
      `select mudar_status_orcamento('${id}', 'fechado', 500, null, '${hoje}')`,
    );
    const l = await linha(id);
    expect(l.status).toBe("fechado");
    expect(l.enviado_em).not.toBeNull();
    expect(l.ultimo_envio_em).toEqual(l.enviado_em);
    expect(await diaMaceio(l.enviado_em)).toBe(hoje);
  });

  it("com um dia anterior usa o meio-dia daquele dia, nunca antes de gerado", async () => {
    const id = await gerado(ALINE, 5);
    const dia = (
      await db.query<{ d: string }>(
        "select ((now() at time zone 'America/Maceio')::date - 2)::text d",
      )
    ).rows[0].d;
    await comoUsuario(
      db,
      ALINE,
      `select mudar_status_orcamento('${id}', 'perdido', null, 'preco', '${dia}')`,
    );
    const l = await linha(id);
    expect(l.status).toBe("perdido");
    expect(await diaMaceio(l.enviado_em)).toBe(dia);
  });

  it("recusa data futura e data antes de gerado", async () => {
    const id = await gerado(ALINE, 2);
    const amanha = (
      await db.query<{ d: string }>(
        "select ((now() at time zone 'America/Maceio')::date + 1)::text d",
      )
    ).rows[0].d;
    const antes = (
      await db.query<{ d: string }>(
        "select ((now() at time zone 'America/Maceio')::date - 10)::text d",
      )
    ).rows[0].d;
    await expect(
      comoUsuario(
        db,
        ALINE,
        `select mudar_status_orcamento('${id}', 'fechado', 500, null, '${amanha}')`,
      ),
    ).rejects.toThrow(/DATA_FUTURA/);
    await expect(
      comoUsuario(
        db,
        ALINE,
        `select mudar_status_orcamento('${id}', 'fechado', 500, null, '${antes}')`,
      ),
    ).rejects.toThrow(/DATA_ANTES_DE_GERADO/);
    expect((await linha(id)).enviado_em).toBeNull();
  });

  it("quem já tem envio registrado não precisa informar a data (e ela não é regravada)", async () => {
    const id = await gerado();
    await comoUsuario(db, ALINE, `select marcar_enviado('${id}')`);
    const antes = await linha(id);
    await comoUsuario(db, ALINE, `select mudar_status_orcamento('${id}', 'fechado', 500)`);
    const l = await linha(id);
    expect(l.status).toBe("fechado");
    expect(l.enviado_em).toEqual(antes.enviado_em);
  });

  it("gerado reaberto (volta de enviado) mantém o envio e fecha sem pedir a data", async () => {
    const id = await gerado();
    await comoUsuario(db, ALINE, `select marcar_enviado('${id}')`);
    await comoUsuario(db, ALINE, `select reabrir_para_edicao('${id}')`);
    expect((await linha(id)).status).toBe("gerado");
    await comoUsuario(
      db,
      ALINE,
      `select mudar_status_orcamento('${id}', 'perdido', null, 'preco')`,
    );
    expect((await linha(id)).enviado_em).not.toBeNull();
  });
});

describe("permissões do registro de envio", () => {
  it("a Aline não registra o envio da Kely; a gerência registra o de qualquer uma", async () => {
    const k = await gerado(KELY);
    await expect(comoUsuario(db, ALINE, `select marcar_enviado('${k}')`)).rejects.toThrow(
      /SEM_PERMISSAO|ORCAMENTO_NAO_ENCONTRADO/,
    );
    await expect(
      comoUsuario(
        db,
        ALINE,
        `select mudar_status_orcamento('${k}', 'fechado', 1, null, current_date)`,
      ),
    ).rejects.toThrow();
    await comoUsuario(db, GERENTE, `select marcar_enviado('${k}')`);
    expect((await linha(k)).status).toBe("enviado");
    const a = await gerado(ALINE);
    await comoUsuario(db, GERENTE, `select marcar_enviado('${a}')`);
    expect((await linha(a)).enviado_em).not.toBeNull();
  });
});

describe("rede de segurança no banco", () => {
  it("por qualquer outro caminho, fechado ou perdido nunca fica com enviado_em vazio", async () => {
    for (const para of ["fechado", "perdido"]) {
      const id = await gerado();
      await db.exec(
        `update orcamentos set status = '${para}', valor_fechado = ${para === "fechado" ? 500 : "null"}, motivo_perda = ${para === "perdido" ? "'preco'" : "null"} where id = '${id}'`,
      );
      const l = await linha(id);
      expect(l.enviado_em, para).not.toBeNull();
      expect(l.ultimo_envio_em, para).not.toBeNull();
    }
  });

  it("não mexe em quem já tinha envio (nem muda a data)", async () => {
    const id = await gerado();
    await comoUsuario(db, ALINE, `select marcar_enviado('${id}')`);
    const antes = await linha(id);
    await db.exec(`update orcamentos set status = 'fechado', valor_fechado = 1 where id = '${id}'`);
    expect((await linha(id)).enviado_em).toEqual(antes.enviado_em);
  });
});
