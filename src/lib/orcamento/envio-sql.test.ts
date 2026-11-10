// Dia 8B no Postgres local (PGlite): marcar_enviado, reabrir_para_edicao, edição bloqueada a partir de
// enviado (gatilho) e a configuração do follow-up.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const CLI = "00000000-0000-0000-0000-0000000000c1";
const orc = (n: number) => `00000000-0000-0000-0000-00000000${String(1000 + n)}`;

let db: PGlite;

/** Cria um orçamento gerado há 3 dias (com um item e um ambiente). */
async function novoGerado(n: number, vendedora = ALINE) {
  await db.exec(`
    insert into orcamentos (id, vendedora_id, cliente_id, status) values ('${orc(n)}', '${vendedora}', '${CLI}', 'rascunho');
    insert into orcamento_itens (orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem)
      values ('${orc(n)}', '9520', 'X', 40, 1, 'Sala', false, 0);
    insert into orcamento_ambientes (orcamento_id, nome, ordem) values ('${orc(n)}', 'Sala', 0);
    update orcamentos set status = 'gerado' where id = '${orc(n)}';
    update orcamentos set gerado_em = now() - interval '3 days' where id = '${orc(n)}';
  `);
}

const marcar = (usuario: string, n: number, data: string | null) =>
  comoUsuario(db, usuario, "select marcar_enviado($1, $2::date)", [orc(n), data]);

const datas = async (n: number) =>
  (
    await db.query<{ status: string; enviado_em: string | null; ultimo: string | null }>(
      `select status, enviado_em::text, ultimo_envio_em::text as ultimo from orcamentos where id = '${orc(n)}'`,
    )
  ).rows[0];

const hojeMaceio = async () =>
  (await db.query<{ d: string }>("select (now() at time zone 'America/Maceio')::date::text as d"))
    .rows[0].d;
const diasAntes = async (dias: number) =>
  (
    await db.query<{ d: string }>(
      `select ((now() at time zone 'America/Maceio')::date - ${dias})::text as d`,
    )
  ).rows[0].d;

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'a@x', 'vendedora'),
      ('${KELY}', 'Kely', 'k@x', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into produtos (codigo, descricao, unidade, preco_unitario) values ('9520', 'STELLA', 'un', 40);
    insert into clientes (id, vendedora_id, nome) values ('${CLI}', '${ALINE}', 'TESTE A');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("marcar_enviado", () => {
  it("hoje: grava o primeiro envio e o último, e vira enviado", async () => {
    await novoGerado(1);
    await marcar(ALINE, 1, null);
    const d = await datas(1);
    expect(d.status).toBe("enviado");
    expect(d.enviado_em).not.toBeNull();
    expect(d.ultimo).toBe(d.enviado_em);
  });

  it("aceita um dia anterior (meio-dia de Maceió) e recusa futuro e antes de gerado", async () => {
    await novoGerado(2);
    await marcar(ALINE, 2, await diasAntes(1));
    const d = await datas(2);
    expect(d.ultimo).toContain("15:00:00"); // 12h em Maceió = 15h UTC (o PGlite mostra em UTC)

    await novoGerado(3);
    const amanha = await diasAntes(-1);
    await expect(marcar(ALINE, 3, amanha)).rejects.toThrow(/DATA_FUTURA/);
    await expect(marcar(ALINE, 3, await diasAntes(4))).rejects.toThrow(/DATA_ANTES_DE_GERADO/);
    expect((await datas(3)).status).toBe("gerado"); // nada mudou
    await marcar(ALINE, 3, await diasAntes(3)); // o próprio dia de gerar vale
    expect((await datas(3)).status).toBe("enviado");
  });

  it("só a dona ou a gerência; só de gerado", async () => {
    await novoGerado(4);
    await expect(marcar(KELY, 4, null)).rejects.toThrow(/SEM_PERMISSAO|ORCAMENTO_NAO_ENCONTRADO/);
    expect((await datas(4)).status).toBe("gerado");
    await marcar(GERENTE, 4, null);
    expect((await datas(4)).status).toBe("enviado");
    await expect(marcar(ALINE, 4, null)).rejects.toThrow(/TRANSICAO_INVALIDA/); // já enviado
    await db.exec(
      `insert into orcamentos (id, vendedora_id, cliente_id, status) values ('${orc(5)}', '${ALINE}', '${CLI}', 'rascunho')`,
    );
    await expect(marcar(ALINE, 5, null)).rejects.toThrow(/TRANSICAO_INVALIDA/); // rascunho
  });

  it("um novo envio depois da edição só muda o último envio", async () => {
    await novoGerado(6);
    await marcar(ALINE, 6, await diasAntes(2));
    const primeiro = await datas(6);

    await comoUsuario(db, ALINE, "select reabrir_para_edicao($1)", [orc(6)]);
    const reaberto = await datas(6);
    expect(reaberto.status).toBe("gerado");
    expect(reaberto.enviado_em).toBe(primeiro.enviado_em); // não apagou
    expect(reaberto.ultimo).toBe(primeiro.ultimo);

    await marcar(ALINE, 6, await hojeMaceio());
    const reenviado = await datas(6);
    expect(reenviado.status).toBe("enviado");
    expect(reenviado.enviado_em).toBe(primeiro.enviado_em); // o primeiro envio continua
    expect(reenviado.ultimo).not.toBe(primeiro.ultimo); // o último é o novo
  });

  it("'Corrigir: não foi enviado' limpa as duas datas", async () => {
    await novoGerado(7);
    await marcar(ALINE, 7, null);
    await comoUsuario(db, ALINE, "select mudar_status_orcamento($1, 'gerado')", [orc(7)]);
    expect(await datas(7)).toEqual({ status: "gerado", enviado_em: null, ultimo: null });
  });

  it("reabrir um fechado volta para enviado mantendo o último envio", async () => {
    await novoGerado(8);
    await marcar(ALINE, 8, await diasAntes(2));
    const antes = await datas(8);
    await comoUsuario(db, ALINE, "select mudar_status_orcamento($1, 'fechado', 100)", [orc(8)]);
    await comoUsuario(db, ALINE, "select mudar_status_orcamento($1, 'enviado')", [orc(8)]);
    const d = await datas(8);
    expect(d.status).toBe("enviado");
    expect(d.ultimo).toBe(antes.ultimo);
  });
});

describe("reabrir_para_edicao", () => {
  it("só a dona (nem a gerência) e só de enviado ou follow-up", async () => {
    await novoGerado(9);
    await expect(
      comoUsuario(db, ALINE, "select reabrir_para_edicao($1)", [orc(9)]),
    ).rejects.toThrow(/TRANSICAO_INVALIDA/); // ainda gerado
    await marcar(ALINE, 9, null);
    await expect(
      comoUsuario(db, GERENTE, "select reabrir_para_edicao($1)", [orc(9)]),
    ).rejects.toThrow(/SEM_PERMISSAO/);
    await expect(comoUsuario(db, KELY, "select reabrir_para_edicao($1)", [orc(9)])).rejects.toThrow(
      /SEM_PERMISSAO/,
    );
    await comoUsuario(db, ALINE, "select mudar_status_orcamento($1, 'followup_d5')", [orc(9)]);
    await comoUsuario(db, ALINE, "select reabrir_para_edicao($1)", [orc(9)]);
    expect((await datas(9)).status).toBe("gerado");
  });
});

describe("edição bloqueada a partir de enviado (gatilho)", () => {
  const sqlItem = (n: number) =>
    `insert into orcamento_itens (orcamento_id, codigo, descricao_congelada, preco_unitario_congelado, quantidade, ambiente, avulso, ordem) values ('${orc(n)}', '9520', 'Y', 1, 1, 'Sala', false, 5)`;
  const comandos = (n: number) => [
    `update orcamento_itens set quantidade = 99 where orcamento_id = '${orc(n)}'`,
    `delete from orcamento_itens where orcamento_id = '${orc(n)}'`,
    sqlItem(n),
    `update orcamento_ambientes set analise = 'x' where orcamento_id = '${orc(n)}'`,
    `delete from orcamento_ambientes where orcamento_id = '${orc(n)}'`,
    `insert into orcamento_ambientes (orcamento_id, nome, ordem) values ('${orc(n)}', 'Nova', 3)`,
  ];

  it("enviado: a dona é barrada pelo gatilho e a gerente não consegue gravar", async () => {
    await novoGerado(10);
    // Em gerado a dona edita normalmente.
    await comoUsuario(
      db,
      ALINE,
      `update orcamento_itens set quantidade = 2 where orcamento_id = '${orc(10)}'`,
    );
    await marcar(ALINE, 10, null);

    for (const sql of comandos(10)) {
      await expect(comoUsuario(db, ALINE, sql), sql).rejects.toThrow(/EDICAO_BLOQUEADA/);
    }
    // A gerente nem tem política de escrita: erro ou zero linhas.
    for (const sql of comandos(10)) {
      const afetadas = await comoUsuario(db, GERENTE, sql).then(
        (r) => r.affectedRows ?? 0,
        () => 0,
      );
      expect(afetadas, sql).toBe(0);
    }
    const q = await db.query<{ quantidade: string }>(
      `select quantidade from orcamento_itens where orcamento_id = '${orc(10)}'`,
    );
    expect(q.rows).toEqual([{ quantidade: "2.00" }]);
  });

  it("vale também para o service role, em follow-up, fechado e perdido", async () => {
    const extra: Record<string, string> = {
      fechado: ", valor_fechado = 100",
      perdido: ", motivo_perda = 'preco'",
    };
    for (const status of ["followup_d5", "followup_d10", "fechado", "perdido"]) {
      await db.exec(
        `update orcamentos set status = '${status}'${extra[status] ?? ""} where id = '${orc(10)}'`,
      );
      await expect(
        db.exec(`update orcamento_itens set quantidade = 7 where orcamento_id = '${orc(10)}'`),
        status,
      ).rejects.toThrow(/EDICAO_BLOQUEADA/);
      await expect(db.exec(sqlItem(10)), status).rejects.toThrow(/EDICAO_BLOQUEADA/);
    }
  });

  it("depois de 'Editar e enviar nova versão' a edição volta; e apagar o orçamento inteiro continua possível", async () => {
    await novoGerado(11);
    await marcar(ALINE, 11, null);
    await expect(
      comoUsuario(
        db,
        ALINE,
        `update orcamento_itens set quantidade = 5 where orcamento_id = '${orc(11)}'`,
      ),
    ).rejects.toThrow(/EDICAO_BLOQUEADA/);
    await comoUsuario(db, ALINE, "select reabrir_para_edicao($1)", [orc(11)]);
    await comoUsuario(
      db,
      ALINE,
      `update orcamento_itens set quantidade = 5 where orcamento_id = '${orc(11)}'`,
    );

    // O cascade de um orçamento enviado não é barrado pelo gatilho.
    await marcar(ALINE, 11, null);
    await db.exec(`delete from orcamentos where id = '${orc(11)}'`);
    const sobrou = await db.query(
      `select 1 from orcamento_itens where orcamento_id = '${orc(11)}'`,
    );
    expect(sobrou.rows).toHaveLength(0);
  });
});

describe("configuração do follow-up", () => {
  it("padrões 5 e 10, mensagens com os marcadores, e o segundo precisa vir depois do primeiro", async () => {
    await db.exec(
      `insert into configuracoes_loja (id, nome_fantasia) values (true, 'Luz Design') on conflict do nothing`,
    );
    const c = await db.query<{
      followup_d5_dias: number;
      followup_d10_dias: number;
      mensagem_d5: string;
      mensagem_d10: string;
    }>(
      "select followup_d5_dias, followup_d10_dias, mensagem_d5, mensagem_d10 from configuracoes_loja",
    );
    expect(c.rows[0]).toMatchObject({ followup_d5_dias: 5, followup_d10_dias: 10 });
    for (const m of [c.rows[0].mensagem_d5, c.rows[0].mensagem_d10]) {
      expect(m).toContain("{cliente}");
      expect(m).toContain("{numero}");
      expect(m).toContain("{vendedora}");
    }
    await expect(db.exec("update configuracoes_loja set followup_d5_dias = 10")).rejects.toThrow();
    await expect(
      db.exec("update configuracoes_loja set followup_d10_dias = 100"),
    ).rejects.toThrow();
    await comoUsuario(
      db,
      GERENTE,
      "update configuracoes_loja set followup_d5_dias = 3, followup_d10_dias = 7",
    );
    const depois = await db.query("select followup_d5_dias from configuracoes_loja");
    expect(depois.rows[0]).toEqual({ followup_d5_dias: 3 });
    const vendedora = await comoUsuario(
      db,
      ALINE,
      "update configuracoes_loja set followup_d5_dias = 1 returning 1",
    );
    expect(vendedora.rows).toHaveLength(0);
  });
});
