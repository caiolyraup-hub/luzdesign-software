// Dia 13B no PGlite, com dados SINTÉTICOS (nada de produção): resumo_piloto conta por vendedora, no dia
// de Maceió, deixa o teste de fora e mostra relatos abertos, erros e custo de IA do dia.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoUsuario, criarBancoLocal } from "../testes/banco-local";
import { formatarMediana, formatarResumo, hojeEmMaceio, type ResumoPiloto } from "./resumo";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
const DIA = "2026-11-19";
let db: PGlite;

async function orc(
  id: string,
  vendedora: string,
  cliente: string,
  criado: string,
  gerado: string | null,
  enviado: string | null,
  piloto = true,
) {
  await db.exec(`
    insert into orcamentos (id, vendedora_id, cliente_id, valor_total, piloto, criado_em, gerado_em, enviado_em)
    values ('${id}', '${vendedora}', '${cliente}', 100, ${piloto},
            '${criado}', ${gerado ? `'${gerado}'` : "null"}, ${enviado ? `'${enviado}'` : "null"});
  `);
}
async function itens(orcId: string, origem: string, n: number) {
  for (let i = 0; i < n; i++)
    await db.exec(`insert into orcamento_itens (orcamento_id, descricao_congelada, preco_unitario_congelado, quantidade, avulso, origem)
      values ('${orcId}', 'Item ${origem} ${i}', 10, 1, true, '${origem}')`);
}

beforeAll(async () => {
  db = await criarBancoLocal();
  // A marca automática depende da data (piloto_inicio); os testes não podem depender do relógio.
  await db.exec("update configuracoes_loja set piloto_inicio = now() + interval '1 year'");
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'caiolyra.up+aline@gmail.com', 'vendedora'),
      ('${KELY}', 'Kely', 'caiolyra.up+kely@gmail.com', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'caiolyra.up+gerencia@gmail.com', 'gerente');
    insert into clientes (id, vendedora_id, nome) values
      ('c0000000-0000-0000-0000-000000000001', '${ALINE}', 'Maria Souza'),
      ('c0000000-0000-0000-0000-000000000002', '${ALINE}', 'Pedro Lima'),
      ('c0000000-0000-0000-0000-000000000003', '${ALINE}', 'TESTE Cliente A de Aline'),
      ('c0000000-0000-0000-0000-000000000004', '${KELY}', 'Ana Costa');
  `);
  // Aline: 2 gerados (12 min e 30 min depois de criados; 1 enviado) + 1 de TESTE (não conta).
  await orc(
    "a0000000-0000-0000-0000-000000000001",
    ALINE,
    "c0000000-0000-0000-0000-000000000001",
    "2026-11-19 09:00-03",
    "2026-11-19 09:12-03",
    "2026-11-19 09:20-03",
  );
  await orc(
    "a0000000-0000-0000-0000-000000000002",
    ALINE,
    "c0000000-0000-0000-0000-000000000002",
    "2026-11-19 10:00-03",
    "2026-11-19 10:30-03",
    null,
  );
  await orc(
    "a0000000-0000-0000-0000-000000000003",
    ALINE,
    "c0000000-0000-0000-0000-000000000003",
    "2026-11-19 11:00-03",
    "2026-11-19 11:05-03",
    "2026-11-19 11:06-03",
    false,
  );
  // Kely: 1 criado e ainda rascunho; 1 criado ontem e gerado hoje às 08:00 (fuso: 23:50 de ontem -> 08:00)
  await orc(
    "a0000000-0000-0000-0000-000000000004",
    KELY,
    "c0000000-0000-0000-0000-000000000004",
    "2026-11-19 14:00-03",
    null,
    null,
  );
  await orc(
    "a0000000-0000-0000-0000-000000000005",
    KELY,
    "c0000000-0000-0000-0000-000000000004",
    "2026-11-18 23:50-03",
    "2026-11-19 08:00-03",
    null,
  );
  await itens("a0000000-0000-0000-0000-000000000001", "manual", 3);
  await itens("a0000000-0000-0000-0000-000000000001", "indicacao_ia", 2);
  await itens("a0000000-0000-0000-0000-000000000001", "kit", 2);
  await itens("a0000000-0000-0000-0000-000000000002", "lista_colada", 4);
  await itens("a0000000-0000-0000-0000-000000000003", "manual", 9); // teste: não conta
  await itens("a0000000-0000-0000-0000-000000000005", "montagem_ia", 1);
  await db.exec(`
    insert into relatos_piloto (usuario_id, mensagem, tela, status, criado_em) values
      ('${ALINE}', 'A busca não achou o código 9520 de primeira', '/orcamentos/x/revisao', 'aberto', '2026-11-19 10:40-03'),
      ('${KELY}', 'Já resolvido', null, 'resolvido', '2026-11-19 10:41-03');
    insert into erros_app (origem, rota, mensagem, criado_em) values
      ('servidor', '/orcamentos', 'Falha de teste do dia', '2026-11-19 12:00-03'),
      ('tela', '/produtos', 'Erro de outro dia', '2026-11-18 12:00-03');
    insert into uso_ia (custo_estimado, criado_em) values
      (0.0014, '2026-11-19 09:05-03'), (0.0079, '2026-11-19 10:20-03'), (0.5, '2026-11-18 10:00-03');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

const resumo = async (quem: string, dia = DIA) =>
  (await comoUsuario<{ r: ResumoPiloto }>(db, quem, `select resumo_piloto('${dia}') as r`)).rows[0]
    .r;

describe("resumo_piloto (dados sintéticos)", () => {
  it("conta por vendedora no dia de Maceió, sem o orçamento de teste", async () => {
    const r = await resumo(GERENTE);
    const aline = r.vendedoras.find((v) => v.nome === "Aline")!;
    const kely = r.vendedoras.find((v) => v.nome === "Kely")!;
    expect([aline.criados, aline.gerados, aline.enviados]).toEqual([2, 2, 1]);
    expect([kely.criados, kely.gerados, kely.enviados]).toEqual([1, 1, 0]); // o de ontem só entra em "gerados"
  });

  it("mediana do início do rascunho até gerar (12 e 30 min -> 21; Kely: 490 min)", async () => {
    const r = await resumo(GERENTE);
    expect(Number(r.vendedoras.find((v) => v.nome === "Aline")!.mediana_ate_gerar_min)).toBe(21);
    expect(Number(r.vendedoras.find((v) => v.nome === "Kely")!.mediana_ate_gerar_min)).toBe(490);
    expect(formatarMediana(21)).toBe("21 min");
    expect(formatarMediana(490)).toBe("8 h 10 min");
    expect(formatarMediana(null)).toBe("—");
  });

  it("itens por origem, sem os do orçamento de teste", async () => {
    const r = await resumo(GERENTE);
    expect(r.vendedoras.find((v) => v.nome === "Aline")!.itens).toEqual({
      manual: 3,
      lista_colada: 4,
      indicacao_ia: 2,
      montagem_ia: 0,
      kit: 2,
    });
    expect(r.vendedoras.find((v) => v.nome === "Kely")!.itens.montagem_ia).toBe(1);
  });

  it("relatos abertos com o texto, erros só do dia e custo de IA só do dia", async () => {
    const r = await resumo(GERENTE);
    expect(r.relatos_abertos).toHaveLength(1);
    expect(r.relatos_abertos[0].mensagem).toContain("código 9520");
    expect(r.erros.map((e) => e.mensagem)).toEqual(["Falha de teste do dia"]);
    expect(Number(r.custo_ia_usd)).toBeCloseTo(0.0093, 4);
  });

  it("outro dia vem zerado; a vendedora não vê o resumo", async () => {
    const r = await resumo(GERENTE, "2026-11-20");
    expect(r.vendedoras.every((v) => v.criados === 0 && v.gerados === 0)).toBe(true);
    expect(r.erros).toHaveLength(0);
    await expect(comoUsuario(db, ALINE, `select resumo_piloto('${DIA}')`)).rejects.toThrow(
      /gerência/,
    );
  });

  it("não tem nada de comissão no resumo", async () => {
    expect(JSON.stringify(await resumo(GERENTE))).not.toMatch(/comiss/i);
  });

  it("o texto do terminal (saída de exemplo com dados sintéticos)", async () => {
    const texto = formatarResumo(await resumo(GERENTE));
    console.log("\n" + texto + "\n");
    expect(texto).toContain("Aline");
    expect(texto).toContain("Relatos abertos (1)");
    expect(hojeEmMaceio(new Date("2026-11-19T02:30:00Z"))).toBe("2026-11-18");
    expect(hojeEmMaceio(new Date("2026-11-19T03:00:00Z"))).toBe("2026-11-19");
  });
});
