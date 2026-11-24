// Dia 14: o backup inteiro no PGlite com dados sintéticos: fazerBackup -> conferirBackup (restaura num
// banco novo e compara contagens e totais por status). Também prova que uma cópia adulterada falha e
// que a lista de tabelas cobre TODAS as tabelas do schema public.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { criarBancoLocal } from "../testes/banco-local";
import { conferirBackup } from "./conferir";
import { fazerBackup, TABELAS, type FonteBackup, type Linha } from "./nucleo";

// Restaurar sobe um Postgres em memória com todas as migrations: leva alguns segundos.
vi.setConfig({ testTimeout: 60_000 });

const ALINE = "00000000-0000-0000-0000-00000000000a";
const GERENTE = "00000000-0000-0000-0000-00000000000c";
let db: PGlite;
let pasta: string;
const arquivos = new Map<string, Uint8Array>([
  ["pdfs/" + ALINE + "/o1/2026-0001-v1.pdf", new TextEncoder().encode("%PDF-1.4 sintetico")],
  ["anexos/" + ALINE + "/o1/foto.jpg", new Uint8Array([1, 2, 3, 4, 5])],
]);

function fontePglite(banco: PGlite): FonteBackup {
  return {
    async lerTabela(nome, ordem, de, quantidade) {
      const r = await banco.query<{ j: Linha }>(
        `select to_jsonb(t) j from public."${nome}" t order by "${ordem}" limit ${quantidade} offset ${de}`,
      );
      return r.rows.map((x) => x.j);
    },
    async contasAuth() {
      const r = await banco.query<{ id: string }>("select id from auth.users order by id");
      return r.rows.map((x) => ({
        id: x.id,
        email: null,
        criado_em: null,
        ultimo_login: null,
        metadata: null,
      }));
    },
    async listarArquivos(bucket) {
      return [...arquivos.keys()]
        .filter((k) => k.startsWith(bucket + "/"))
        .map((k) => ({ caminho: k.slice(bucket.length + 1) }));
    },
    async baixarArquivo(bucket, caminho) {
      return arquivos.get(`${bucket}/${caminho}`)!;
    },
    async ultimaMigration() {
      return "20261119000100";
    },
  };
}

beforeAll(async () => {
  db = await criarBancoLocal();
  await db.exec("update configuracoes_loja set piloto_inicio = now() + interval '1 year'");
  await db.exec(`
    insert into auth.users values ('${ALINE}'), ('${GERENTE}');
    insert into usuarios values
      ('${ALINE}', 'Aline', 'caiolyra.up+aline@gmail.com', 'vendedora'),
      ('${GERENTE}', 'Gerência', 'g@x', 'gerente');
    insert into clientes (id, vendedora_id, nome, whatsapp) values
      ('c0000000-0000-0000-0000-000000000001', '${ALINE}', 'Maria Souza', '82999990000'),
      ('c0000000-0000-0000-0000-000000000002', '${ALINE}', 'João Lima', null);
    insert into orcamentos (id, vendedora_id, cliente_id, valor_total, status) values
      ('b0000000-0000-0000-0000-000000000001', '${ALINE}', 'c0000000-0000-0000-0000-000000000001', 1234.56, 'rascunho'),
      ('b0000000-0000-0000-0000-000000000002', '${ALINE}', 'c0000000-0000-0000-0000-000000000002', 777.10, 'rascunho');
    update orcamentos set status = 'gerado' where id = 'b0000000-0000-0000-0000-000000000002';
    insert into orcamento_itens (orcamento_id, descricao_congelada, preco_unitario_congelado, quantidade, avulso, origem)
      values ('b0000000-0000-0000-0000-000000000001', 'Pendente', 100.5, 2, true, 'kit');
    insert into relatos_piloto (usuario_id, mensagem) values ('${ALINE}', 'Relato de teste do backup');
  `);
  pasta = mkdtempSync(path.join(os.tmpdir(), "backup-teste-"));
  await fazerBackup({ fonte: fontePglite(db), pasta, projeto: "teste", commit: "abc1234" });
}, 120_000);

afterAll(async () => {
  await db.close();
  rmSync(pasta, { recursive: true, force: true });
});

describe("backup e conferência", () => {
  it("a lista de tabelas cobre todas as tabelas do schema public", async () => {
    const r = await db.query<{ t: string }>(
      `select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
    );
    expect(TABELAS.map((t) => t.nome).sort()).toEqual(r.rows.map((x) => x.t));
  });

  it("o manifesto traz contagens, totais por status, commit e migration", () => {
    const m = JSON.parse(readFileSync(path.join(pasta, "manifesto.json"), "utf8"));
    expect(m.commit).toBe("abc1234");
    expect(m.ultima_migration).toBe("20261119000100");
    expect(m.tabelas.orcamentos.linhas).toBe(2);
    expect(m.tabelas.clientes.linhas).toBe(2);
    expect(m.totais.orcamentos_por_status.rascunho).toEqual({
      quantidade: 1,
      valor_centavos: 123456,
    });
    expect(m.totais.orcamentos_por_status.gerado).toEqual({ quantidade: 1, valor_centavos: 77710 });
    expect(m.storage.pdfs.arquivos).toBe(1);
    expect(m.storage.anexos.arquivos).toBe(1);
    expect(m.auth.contas).toBe(2);
  });

  it("copia os arquivos do Storage com o mesmo caminho", () => {
    const pdf = readFileSync(
      path.join(pasta, "storage", "pdfs", ALINE, "o1", "2026-0001-v1.pdf"),
      "utf8",
    );
    expect(pdf).toBe("%PDF-1.4 sintetico");
  });

  it("restaura num banco novo e todas as contagens e totais batem", async () => {
    const r = await conferirBackup(pasta, criarBancoLocal, "20261119000100");
    expect(r.linhas.filter((l) => !l.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(
      r.linhas.some((l) => l.texto.startsWith("status gerado: 1 orçamento(s), R$ 777.10")),
    ).toBe(true);
  });

  it("falha quando falta uma linha, quando o arquivo muda e quando falta o manifesto", async () => {
    const copia = mkdtempSync(path.join(os.tmpdir(), "backup-adulterado-"));
    try {
      await fazerBackup({ fonte: fontePglite(db), pasta: copia, projeto: "teste", commit: "x" });
      // 1) tira uma linha de orcamentos
      const arq = path.join(copia, "tabelas", "orcamentos.json");
      const linhas = JSON.parse(readFileSync(arq, "utf8"));
      writeFileSync(arq, JSON.stringify(linhas.slice(1)));
      const r1 = await conferirBackup(copia, criarBancoLocal);
      expect(r1.ok).toBe(false);
      expect(r1.linhas.some((l) => !l.ok && l.texto.includes("orcamentos"))).toBe(true);
      // 2) arquivo do Storage adulterado
      writeFileSync(
        path.join(copia, "storage", "pdfs", ALINE, "o1", "2026-0001-v1.pdf"),
        "outro conteudo",
      );
      const r2 = await conferirBackup(copia, criarBancoLocal);
      expect(r2.linhas.some((l) => !l.ok && l.texto.startsWith("storage/pdfs"))).toBe(true);
      // 3) sem manifesto
      rmSync(path.join(copia, "manifesto.json"));
      expect((await conferirBackup(copia, criarBancoLocal)).ok).toBe(false);
    } finally {
      rmSync(copia, { recursive: true, force: true });
    }
  }, 120_000);

  it("avisa quando o backup é de uma migration mais nova que a do repositório", async () => {
    const r = await conferirBackup(pasta, criarBancoLocal, "20261101000000");
    expect(r.ok).toBe(false);
    expect(r.linhas.some((l) => !l.ok && l.texto.includes("mais nova"))).toBe(true);
  });
});
