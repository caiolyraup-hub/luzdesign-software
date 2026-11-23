/* eslint-disable @typescript-eslint/no-explicit-any -- JSON das funções SQL */
// Dia 15 no PGlite: apagar_todos_orcamentos. Simulação não muda nada; executar leva só o que depende de
// orçamento (inclusive em status enviado/fechado) e deixa catálogo, usuários, arquitetos, configurações
// e percentuais intactos; piloto só sai se pedido; tudo-ou-nada se um passo falhar.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const ARQ = "a0000000-0000-0000-0000-000000000001";
const O = (n: number) => `b0000000-0000-0000-0000-00000000000${n}`;
const C = (n: number) => `c0000000-0000-0000-0000-00000000000${n}`;
let db: PGlite;

async function preparar() {
  db = await criarBancoLocal();
  await db.exec("update configuracoes_loja set piloto_inicio = now() + interval '1 year'");
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'caiolyra.up+aline@gmail.com', 'vendedora'),
      ('${KELY}', 'Kely', 'caiolyra.up+kely@gmail.com', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into arquitetos (id, nome) values ('${ARQ}', 'Helena Prado');
    insert into comissoes_arquiteto_percentual (arquiteto_id, percentual) values ('${ARQ}', 5);
    insert into comissoes_vendedora_percentual (vendedora_id, percentual) values ('${ALINE}', 3);
    insert into clientes (id, vendedora_id, nome) values
      ('${C(1)}', '${ALINE}', 'Cliente Um'), ('${C(2)}', '${KELY}', 'Cliente Dois'),
      ('${C(3)}', '${ALINE}', 'Cliente Piloto'), ('${C(4)}', '${KELY}', 'Cliente Sem Orçamento');
    insert into orcamentos (id, vendedora_id, cliente_id, valor_total, status, piloto) values
      ('${O(1)}', '${ALINE}', '${C(1)}', 1000, 'rascunho', false),
      ('${O(2)}', '${KELY}', '${C(2)}', 2500.50, 'rascunho', false),
      ('${O(3)}', '${ALINE}', '${C(3)}', 4000, 'rascunho', true);
    insert into orcamento_itens (orcamento_id, descricao_congelada, preco_unitario_congelado, quantidade, avulso)
      select id, 'Item', 10, 1, true from orcamentos;
    insert into anexos (orcamento_id, caminho_storage, tipo) values ('${O(1)}', '${ALINE}/${O(1)}/f.jpg', 'foto');
    insert into indicacoes_ia (orcamento_id, vendedora_id, ambiente, resposta) values ('${O(1)}', '${ALINE}', 'sala', '{}');
    insert into uso_ia (orcamento_id, vendedora_id, custo_estimado) values ('${O(1)}', '${ALINE}', 0.1), (null, '${ALINE}', 0.2);
    insert into eventos_exportacao (usuario_id) values ('${GERENTE}');
    insert into relatos_piloto (usuario_id, mensagem) values ('${ALINE}', 'um relato qualquer');
    insert into erros_app (origem, mensagem) values ('tela', 'erro qualquer');
    update orcamentos set status = 'gerado' where id in ('${O(2)}', '${O(3)}');
    update orcamentos set status = 'enviado' where id = '${O(2)}';
    update orcamentos set status = 'fechado', valor_fechado = 2500.50 where id = '${O(2)}';
    update comissoes_vendedora_percentual set percentual = 3;
  `);
  // produtos vêm do seed das migrations? garante pelo menos um
  await db.exec(
    "insert into produtos (codigo, descricao, preco_unitario) values ('9001', 'Produto de teste da limpeza', 10) on conflict do nothing",
  );
}

beforeAll(preparar, 120_000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false)");
});

const rodar = async (...args: boolean[]) =>
  (await db.query<{ r: any }>(`select apagar_todos_orcamentos(${args.join(", ") || ""}) as r`))
    .rows[0].r;
const contar = async (t: string) =>
  Number((await db.query<{ n: string }>(`select count(*)::text n from public.${t}`)).rows[0].n);

describe("apagar_todos_orcamentos", () => {
  it("só o servidor executa: gerência e vendedora não", async () => {
    for (const quem of [GERENTE, ALINE])
      await expect(comoUsuario(db, quem, "select apagar_todos_orcamentos()")).rejects.toThrow();
  });

  it("simulação (padrão) não muda nada e relata o que sairia", async () => {
    const antes = await contar("orcamentos");
    const r = await rodar();
    expect(r.executado).toBe(false);
    expect(await contar("orcamentos")).toBe(antes);
    expect(r.antes.orcamentos).toBe(2); // sem o piloto
    expect(r.antes.orcamentos_piloto).toBe(0);
    expect(r.antes.por_status).toEqual({ rascunho: 1, fechado: 1 });
    expect(r.antes.por_vendedora).toEqual({ Aline: 1, Kely: 1 });
    expect(Number(r.antes.valor_total)).toBe(3500.5);
    expect(r.antes.orcamento_itens).toBe(2);
    expect(r.antes.anexos).toBe(1);
    expect(r.antes.uso_ia_do_orcamento).toBe(1);
    expect(r.antes.eventos_exportacao).toBe(1);
    expect(r.orcamentos).toHaveLength(2);
    // clientes sem orçamento depois: o 4 já não tinha; 1 e 2 ficariam sem; o 3 (piloto) fica protegido
    expect(r.clientes_sem_orcamento.map((c: any) => c.nome).sort()).toEqual([
      "Cliente Dois",
      "Cliente Sem Orçamento",
      "Cliente Um",
    ]);
  });

  it("com o piloto incluído a simulação conta o piloto à parte", async () => {
    const r = await rodar(false, true);
    expect(r.antes.orcamentos).toBe(3);
    expect(r.antes.orcamentos_piloto).toBe(1);
  });

  it("falha no meio: nada é apagado (tudo ou nada)", async () => {
    await db.exec(`
      create function _falha() returns trigger language plpgsql as $$ begin raise exception 'FALHA DE TESTE'; end $$;
      create trigger _falha_cliente before delete on clientes for each row execute function _falha();
    `);
    const antes = {
      o: await contar("orcamentos"),
      u: await contar("uso_ia"),
      e: await contar("eventos_exportacao"),
    };
    await expect(rodar(true, false, true)).rejects.toThrow(/FALHA DE TESTE/);
    expect(await contar("orcamentos")).toBe(antes.o);
    expect(await contar("uso_ia")).toBe(antes.u);
    expect(await contar("eventos_exportacao")).toBe(antes.e);
    await db.exec("drop trigger _falha_cliente on clientes; drop function _falha()");
  });

  it("executar leva o que depende de orçamento (mesmo enviado/fechado), preserva o piloto e tudo que deve ficar", async () => {
    const fica = (await rodar()).fica;
    const r = await rodar(true); // sem apagar clientes nem contador
    expect(r.executado).toBe(true);
    expect(r.depois.orcamentos_total).toBe(1); // só o piloto
    expect(r.depois.orcamento_itens).toBe(1);
    expect(r.depois.anexos).toBe(0);
    expect(r.depois.indicacoes_ia).toBe(0);
    expect(r.depois.eventos_exportacao).toBe(0);
    expect(r.depois.uso_ia_do_orcamento).toBe(0);
    expect(r.depois.clientes).toBe(4); // clientes ficam por padrão
    // o que fica não mudou (inclui a linha de uso_ia sem orçamento, percentuais e o catálogo)
    expect(r.fica).toEqual(fica);
    expect(r.fica.uso_ia_sem_orcamento).toBe(1);
    expect(r.fica.comissoes_vendedora_percentual).toBe(1);
    const piloto = await db.query<{ numero: string }>("select numero from orcamentos where piloto");
    expect(piloto.rows).toHaveLength(1);
  });

  it("incluindo o piloto, clientes e contador: zera tudo e o contador volta", async () => {
    const fica = (await rodar()).fica;
    const r = await rodar(true, true, true, true);
    expect(r.depois.orcamentos_total).toBe(0);
    expect(r.depois.clientes).toBe(0);
    expect(r.depois.orcamento_itens).toBe(0);
    expect(Object.values(r.depois.contador)).toEqual([0]);
    expect(r.fica).toEqual(fica); // catálogo, usuários, arquitetos, percentuais, configurações...
    expect((await rodar()).antes.orcamentos).toBe(0);
  });

  it("um orçamento novo depois da limpeza volta a ser 0001 quando o contador foi reiniciado", async () => {
    await db.exec(
      `insert into clientes (id, vendedora_id, nome) values ('${C(9)}', '${ALINE}', 'Novo')`,
    );
    await db.exec(
      `insert into orcamentos (vendedora_id, cliente_id, valor_total) values ('${ALINE}', '${C(9)}', 1)`,
    );
    const n = await db.query<{ numero: string }>("select numero from orcamentos");
    expect(n.rows[0].numero).toMatch(/-0001$/);
  });
});
