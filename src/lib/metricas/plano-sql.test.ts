// Dia 9A: com alguns milhares de orçamentos, a consulta de métricas usa os índices por data de etapa.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarBancoLocal } from "../testes/banco-local";

const ALINE = "00000000-0000-0000-0000-00000000000a";
const KELY = "00000000-0000-0000-0000-00000000000b";
let db: PGlite;

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${KELY}');
    insert into usuarios values ('${ALINE}', 'Aline', 'a@x', 'vendedora'), ('${KELY}', 'Kely', 'k@x', 'vendedora');
    insert into clientes (id, vendedora_id, nome) values
      ('00000000-0000-0000-0000-0000000000c1', '${ALINE}', 'A'), ('00000000-0000-0000-0000-0000000000c2', '${KELY}', 'K');
    alter table orcamentos disable trigger user;
    insert into orcamentos (numero, vendedora_id, cliente_id, status, valor_total, criado_em, gerado_em, enviado_em, fechado_em)
      select 'T-' || g,
             case when g % 2 = 0 then '${ALINE}'::uuid else '${KELY}'::uuid end,
             case when g % 2 = 0 then '00000000-0000-0000-0000-0000000000c1'::uuid else '00000000-0000-0000-0000-0000000000c2'::uuid end,
             case when g % 7 = 0 then 'fechado'::status_orcamento else 'gerado'::status_orcamento end,
             1000,
             now() - (g || ' hours')::interval * 2,
             now() - (g || ' hours')::interval * 2,
             case when g % 7 = 0 then now() - (g || ' hours')::interval * 2 end,
             case when g % 7 = 0 then now() - (g || ' hours')::interval * 2 end
        from generate_series(1, 6000) g;
    analyze orcamentos;
  `);
}, 90_000);
afterAll(async () => db.close());

it("o filtro por data de etapa de um mês usa índice (não varre os 6.000)", async () => {
  const { rows } = await db.query<{ "QUERY PLAN": string }>(`
    explain
    select * from orcamentos_reais
     where (criado_em >= now() - interval '30 days' and criado_em < now())
        or (gerado_em >= now() - interval '30 days' and gerado_em < now())
        or (enviado_em >= now() - interval '30 days' and enviado_em < now())
        or (fechado_em >= now() - interval '30 days' and fechado_em < now())
        or (perdido_em >= now() - interval '30 days' and perdido_em < now())
        or status in ('enviado', 'followup_d5', 'followup_d10')`);
  const plano = rows.map((r) => r["QUERY PLAN"]).join("\n");
  console.log(plano);
  expect(plano).toMatch(/Index|Bitmap/);
});

it("metricas_orcamentos roda rápido com 6.000 orçamentos", async () => {
  const t0 = Date.now();
  await db.query("select metricas_orcamentos(current_date - 30, current_date)");
  const ms = Date.now() - t0;
  console.log("metricas_orcamentos:", ms, "ms");
  expect(ms).toBeLessThan(2000);
});
