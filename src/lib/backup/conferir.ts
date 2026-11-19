// `backup:conferir`: prova que o backup está inteiro. Confere os arquivos pelo manifesto (tamanho e
// soma de verificação) e RESTAURA as tabelas num Postgres local em memória (PGlite) com as migrations
// do repositório, comparando contagens e os totais dos orçamentos por status.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import {
  centavos,
  sha256,
  TABELAS,
  totaisDosOrcamentos,
  type Linha,
  type Manifesto,
} from "./nucleo";

export interface ResultadoConferencia {
  ok: boolean;
  linhas: { ok: boolean; texto: string }[];
}

/** Restaura as tabelas do backup num banco que já tem as migrations (sem gatilhos nem chaves). */
export async function restaurarNoPglite(db: PGlite, pasta: string): Promise<void> {
  const contas = JSON.parse(readFileSync(path.join(pasta, "auth_usuarios.json"), "utf8")) as {
    id: string;
  }[];
  await db.exec("set session_replication_role = replica");
  // as migrations já deixam linhas de seed (configurações, contador...): o backup é que manda
  await db.exec(`truncate table ${TABELAS.map((t) => `public."${t.nome}"`).join(", ")} cascade`);
  for (const c of contas)
    await db.query("insert into auth.users (id) values ($1) on conflict do nothing", [c.id]);
  for (const { nome } of TABELAS) {
    const linhas = JSON.parse(
      readFileSync(path.join(pasta, "tabelas", `${nome}.json`), "utf8"),
    ) as Linha[];
    if (linhas.length === 0) continue;
    // colunas gravaveis (as geradas são recalculadas pelo banco)
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'
        order by ordinal_position`,
      [nome],
    );
    const lista = cols.rows.map((c) => `"${c.column_name}"`).join(", ");
    await db.query(
      `insert into public."${nome}" (${lista}) overriding system value
       select ${lista} from jsonb_populate_recordset(null::public."${nome}", $1::jsonb)`,
      [JSON.stringify(linhas)],
    );
  }
  await db.exec("set session_replication_role = origin");
}

export async function conferirBackup(
  pasta: string,
  criarBanco: () => Promise<PGlite>,
  migrationsDoRepositorio: string | null = null,
): Promise<ResultadoConferencia> {
  const linhas: ResultadoConferencia["linhas"] = [];
  const ver = (ok: boolean, texto: string) => linhas.push({ ok, texto });
  const arquivo = path.join(pasta, "manifesto.json");
  if (!existsSync(arquivo)) {
    ver(false, `manifesto.json não existe em ${pasta}`);
    return { ok: false, linhas };
  }
  const m = JSON.parse(readFileSync(arquivo, "utf8")) as Manifesto;
  ver(
    true,
    `manifesto de ${m.criado_em} (commit ${m.commit}, migration ${m.ultima_migration ?? "?"})`,
  );

  // 1) arquivos das tabelas: tamanho e soma
  for (const { nome } of TABELAS) {
    const info = m.tabelas[nome];
    const caminho = path.join(pasta, "tabelas", `${nome}.json`);
    if (!info || !existsSync(caminho)) {
      ver(false, `tabela ${nome}: arquivo ou manifesto ausente`);
      continue;
    }
    const texto = readFileSync(caminho, "utf8");
    const n = (JSON.parse(texto) as unknown[]).length;
    ver(
      sha256(texto) === info.sha256 && n === info.linhas,
      `tabela ${nome}: ${n} linha(s), soma de verificação ${sha256(texto) === info.sha256 ? "confere" : "NÃO confere"}`,
    );
  }
  const auth = path.join(pasta, m.auth.arquivo);
  ver(
    existsSync(auth) && sha256(readFileSync(auth, "utf8")) === m.auth.sha256,
    `contas do Auth: ${m.auth.contas}`,
  );

  // 2) arquivos do Storage
  for (const [bucket, info] of Object.entries(m.storage)) {
    let falhas = 0;
    for (const f of info.lista) {
      const caminho = path.join(pasta, "storage", bucket, f.caminho);
      if (
        !existsSync(caminho) ||
        statSync(caminho).size !== f.bytes ||
        sha256(readFileSync(caminho)) !== f.sha256
      )
        falhas++;
    }
    ver(
      falhas === 0,
      `storage/${bucket}: ${info.arquivos} arquivo(s)${falhas ? `, ${falhas} com problema` : ", todos conferem"}`,
    );
  }

  // 3) restaura num Postgres local e compara
  const db = await criarBanco();
  try {
    if (
      migrationsDoRepositorio &&
      m.ultima_migration &&
      m.ultima_migration > migrationsDoRepositorio
    )
      ver(
        false,
        `o backup é de uma migration mais nova (${m.ultima_migration}) que a do repositório (${migrationsDoRepositorio})`,
      );
    await restaurarNoPglite(db, pasta);
    for (const { nome } of TABELAS) {
      const r = await db.query<{ n: string }>(`select count(*)::text n from public."${nome}"`);
      const n = Number(r.rows[0].n);
      ver(
        n === m.tabelas[nome]?.linhas,
        `restaurado ${nome}: ${n} de ${m.tabelas[nome]?.linhas} linha(s)`,
      );
    }
    const o = await db.query<Linha>(
      "select status::text as status, valor_total from public.orcamentos",
    );
    const refeito = totaisDosOrcamentos(o.rows);
    ver(
      refeito.orcamentos === m.totais.orcamentos,
      `orçamentos: ${refeito.orcamentos} (manifesto ${m.totais.orcamentos})`,
    );
    for (const s of new Set([
      ...Object.keys(refeito.orcamentos_por_status),
      ...Object.keys(m.totais.orcamentos_por_status),
    ])) {
      const a = refeito.orcamentos_por_status[s] ?? { quantidade: 0, valor_centavos: 0 };
      const b = m.totais.orcamentos_por_status[s] ?? { quantidade: 0, valor_centavos: 0 };
      ver(
        a.quantidade === b.quantidade && a.valor_centavos === b.valor_centavos,
        `status ${s}: ${a.quantidade} orçamento(s), R$ ${(a.valor_centavos / 100).toFixed(2)} (manifesto ${b.quantidade}, R$ ${(b.valor_centavos / 100).toFixed(2)})`,
      );
    }
    const soma = await db.query<{ v: string }>(
      "select coalesce(sum(valor_total), 0)::text v from public.orcamentos",
    );
    const somaManifesto = Object.values(m.totais.orcamentos_por_status).reduce(
      (s, x) => s + x.valor_centavos,
      0,
    );
    ver(
      centavos(soma.rows[0].v) === somaManifesto,
      `valor total dos orçamentos: R$ ${(centavos(soma.rows[0].v) / 100).toFixed(2)}`,
    );
  } finally {
    await db.close();
  }
  return { ok: linhas.every((l) => l.ok), linhas };
}
