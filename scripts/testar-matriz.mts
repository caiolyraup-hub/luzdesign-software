// Matriz de permissões (dia 12C): perfil × recurso × ação, com o TOKEN REAL de cada perfil, direto pela
// API do Supabase (tabelas, funções e Storage). Perfis: Aline, Kely, gerente, dono e um usuário logado
// SEM papel (conta criada no Auth, sem linha em `usuarios`). Qualquer célula fora do esperado falha.
// Uso: pnpm test:rls   (com --docs também grava docs/permissoes.md)
import { writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável ${nome} ausente no .env.local`);
  return v;
}
const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const senha = exigir("SEED_SENHA_INICIAL");
const opcoes = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, exigir("SUPABASE_SERVICE_ROLE_KEY"), opcoes);

const PERFIS = ["Aline", "Kely", "Gerente", "Dono", "Sem papel"] as const;
type Perfil = (typeof PERFIS)[number];
interface Pessoa {
  c: SupabaseClient;
  id: string;
}
async function entrar(email: string, pass = senha): Promise<Pessoa> {
  const c = createClient(url, anonKey, opcoes);
  const { data, error } = await c.auth.signInWithPassword({ email, password: pass });
  if (error || !data.user) throw new Error(`Login falhou para ${email}: ${error?.message}`);
  return { c, id: data.user.id };
}

// Conta logada SEM papel (sem linha em usuarios): o que um cadastro público conseguiria.
const EMAIL_SEM_PAPEL = `matriz.sempapel.${Date.now()}@example.com`;
const SENHA_SEM_PAPEL = `Sp-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const criada = await admin.auth.admin.createUser({
  email: EMAIL_SEM_PAPEL,
  password: SENHA_SEM_PAPEL,
  email_confirm: true,
});
if (criada.error) throw criada.error;

const pessoas: Record<Perfil, Pessoa> = {
  Aline: await entrar(exigir("SEED_EMAIL_ALINE")),
  Kely: await entrar(exigir("SEED_EMAIL_KELY")),
  Gerente: await entrar(exigir("SEED_EMAIL_GERENCIA")),
  Dono: await entrar(exigir("SEED_EMAIL_DONO")),
  "Sem papel": await entrar(EMAIL_SEM_PAPEL, SENHA_SEM_PAPEL),
};

// ---------------------------------------------------------------- fixtures (todas marcadas "matriz")
const aline = pessoas.Aline.id;
const kely = pessoas.Kely.id;
const marca = { matriz: "true" };
const ids: Record<string, string> = {};
async function limpar() {
  await admin.from("orcamentos").delete().eq("respostas->>matriz", "true");
  await admin.from("clientes").delete().like("nome", "MATRIZ%");
  await admin.from("arquitetos").delete().like("nome", "MATRIZ%");
  await admin.from("produtos").delete().eq("codigo", "99994");
  if (ids.orcA) {
    await admin.storage.from("anexos").remove([`${aline}/${ids.orcA}/a.jpg`]);
    await admin.storage.from("pdfs").remove([`${aline}/${ids.orcA}/a.pdf`]);
  }
  await admin.from("eventos_exportacao").delete().eq("filtros->>matriz", "true");
  await admin.from("erros_app").delete().eq("mensagem", "matriz");
  await admin
    .from("comissoes_arquiteto_percentual")
    .delete()
    .eq("arquiteto_id", ids.arq ?? "00000000-0000-0000-0000-000000000000");
  await admin.storage.from("arquitetos").remove(["matriz/foto.jpg"]);
  const { data: numeros } = await admin
    .from("orcamentos")
    .select("numero")
    .like("numero", "2026-%");
  const maior = Math.max(0, ...(numeros ?? []).map((n) => Number(String(n.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

async function criarFixtures() {
  for (const [rotulo, dona] of [
    ["A", aline],
    ["K", kely],
  ] as const) {
    const cli = await admin
      .from("clientes")
      .insert({ vendedora_id: dona, nome: `MATRIZ Cliente ${rotulo}` })
      .select("id")
      .single();
    const o = await admin
      .from("orcamentos")
      .insert({ vendedora_id: dona, cliente_id: cli.data!.id, respostas: marca, valor_total: 100 })
      .select("id")
      .single();
    await admin.from("orcamentos").update({ status: "gerado" }).eq("id", o.data!.id);
    const it = await admin
      .from("orcamento_itens")
      .insert({
        orcamento_id: o.data!.id,
        codigo: null,
        descricao_congelada: `MATRIZ item ${rotulo}`,
        preco_unitario_congelado: 1,
        quantidade: 1,
        ambiente: "Geral",
        avulso: true,
        ordem: 0,
      })
      .select("id")
      .single();
    const ind = await admin
      .from("indicacoes_ia")
      .insert({ orcamento_id: o.data!.id, vendedora_id: dona, ambiente: "Geral", resposta: {} })
      .select("id")
      .single();
    ids[`cli${rotulo}`] = cli.data!.id;
    ids[`orc${rotulo}`] = o.data!.id;
    ids[`item${rotulo}`] = it.data!.id;
    ids[`ind${rotulo}`] = ind.data!.id;
  }
  const arq = await admin
    .from("arquitetos")
    .insert({ nome: "MATRIZ Arq Ativo", whatsapp: "+5582900000001" })
    .select("id")
    .single();
  const arqI = await admin
    .from("arquitetos")
    .insert({ nome: "MATRIZ Arq Inativo", ativo: false })
    .select("id")
    .single();
  ids.arq = arq.data!.id;
  ids.arqI = arqI.data!.id;
  await admin
    .from("produtos")
    .insert({ codigo: "99994", categoria: "SPOT", descricao: "SPOT MATRIZ", preco_unitario: 10 });
  await admin
    .from("produtos_dados_fornecedor")
    .insert({ codigo: "99994", fabricante: "FABMATRIZ", referencia_fabricante: "REF-MATRIZ-1" });
  // Comissão: orçamento fechado pela Aline com percentual definido (o gatilho gera as linhas).
  await admin
    .from("configuracoes_comissao")
    .update({ percentual_vendedora_padrao: 3 })
    .eq("id", true);
  await admin
    .from("orcamentos")
    .update({ status: "fechado", valor_fechado: 100 })
    .eq("id", ids.orcA);
  const { data: com } = await admin
    .from("comissoes")
    .select("id")
    .eq("orcamento_id", ids.orcA)
    .limit(1)
    .single();
  ids.com = com!.id;
  await admin.from("erros_app").insert({ origem: "servidor", mensagem: "matriz" });
  await admin
    .from("comissoes_arquiteto_percentual")
    .insert({ arquiteto_id: ids.arq, percentual: 4 });
  await admin
    .from("eventos_exportacao")
    .insert({ usuario_id: aline, filtros: { matriz: "true" }, linhas: 1 });
  // Arquivos em Storage (caminho no padrão {vendedora}/{orçamento}/{arquivo}).
  const blob = new Blob(["matriz"], { type: "image/jpeg" });
  await admin.storage
    .from("anexos")
    .upload(`${aline}/${ids.orcA}/a.jpg`, blob, { upsert: true, contentType: "image/jpeg" });
  await admin.storage
    .from("pdfs")
    .upload(`${aline}/${ids.orcA}/a.pdf`, new Blob(["%PDF-1.4"], { type: "application/pdf" }), {
      upsert: true,
      contentType: "application/pdf",
    })
    .catch(() => null);
  await admin.storage
    .from("arquitetos")
    .upload("matriz/foto.jpg", blob, { upsert: true, contentType: "image/jpeg" })
    .catch(() => null);
}

// ---------------------------------------------------------------- a matriz
type Esperado = Record<Perfil, boolean>;
const E = (
  aline: boolean,
  kely: boolean,
  gerente: boolean,
  dono: boolean,
  sem: boolean,
): Esperado => ({
  Aline: aline,
  Kely: kely,
  Gerente: gerente,
  Dono: dono,
  "Sem papel": sem,
});
const TODOS_COM_PAPEL = E(true, true, true, true, false);
const SO_GERENCIA = E(false, false, true, true, false);
const SO_DONO = E(false, false, false, true, false);
const NINGUEM = E(false, false, false, false, false);

interface Celula {
  recurso: string;
  acao: string;
  esperado: Esperado;
  /** true = o perfil consegue; false = é barrado. */
  rodar: (p: Pessoa) => Promise<boolean>;
}
const linhasVisiveis = (tabela: string, col: string, valor: string) => async (p: Pessoa) => {
  const r = await p.c.from(tabela).select(col).eq(col, valor);
  return !r.error && (r.data?.length ?? 0) > 0;
};
const funcaoFalha = (nome: string, args: () => Record<string, unknown>) => async (p: Pessoa) =>
  !(await p.c.rpc(nome, args())).error;
/** Chamada que pode falhar por REGRA de negócio: só conta como barrada se o erro for de permissão. */
const NEGADO =
  /SEM_PERMISSAO|NAO_ENCONTRAD|permission|42501|Só a gerência|Sem permissão|not found/i;
const passaPermissao = (nome: string, args: () => Record<string, unknown>) => async (p: Pessoa) => {
  const { error } = await p.c.rpc(nome, args());
  return !error || !NEGADO.test(error.message);
};
const baixa = (bucket: string, caminho: string) => async (p: Pessoa) =>
  !(await p.c.storage.from(bucket).download(caminho)).error;

function montar(): Celula[] {
  return [
    // --- orçamentos e o que pende deles: a vendedora só vê os próprios; gerência vê tudo
    {
      recurso: "orcamentos",
      acao: "ler o orçamento da Aline",
      esperado: E(true, false, true, true, false),
      rodar: linhasVisiveis("orcamentos", "id", ids.orcA),
    },
    {
      recurso: "orcamentos",
      acao: "ler o orçamento da Kely",
      esperado: E(false, true, true, true, false),
      rodar: linhasVisiveis("orcamentos", "id", ids.orcK),
    },
    {
      recurso: "orcamento_itens",
      acao: "ler item do orçamento da Aline",
      esperado: E(true, false, true, true, false),
      rodar: linhasVisiveis("orcamento_itens", "id", ids.itemA),
    },
    {
      recurso: "orcamento_itens",
      acao: "ler item do orçamento da Kely",
      esperado: E(false, true, true, true, false),
      rodar: linhasVisiveis("orcamento_itens", "id", ids.itemK),
    },
    {
      recurso: "clientes",
      acao: "ler cliente da Aline",
      esperado: E(true, false, true, true, false),
      rodar: linhasVisiveis("clientes", "id", ids.cliA),
    },
    {
      recurso: "clientes",
      acao: "ler cliente da Kely",
      esperado: E(false, true, true, true, false),
      rodar: linhasVisiveis("clientes", "id", ids.cliK),
    },
    {
      recurso: "indicacoes_ia",
      acao: "ler indicação da Aline",
      esperado: E(true, false, true, true, false),
      rodar: linhasVisiveis("indicacoes_ia", "id", ids.indA),
    },
    {
      recurso: "indicacoes_ia",
      acao: "ler indicação da Kely",
      esperado: E(false, true, true, true, false),
      rodar: linhasVisiveis("indicacoes_ia", "id", ids.indK),
    },
    // --- catálogo
    {
      recurso: "produtos",
      acao: "ler produto (preço)",
      esperado: TODOS_COM_PAPEL,
      rodar: linhasVisiveis("produtos", "codigo", "99994"),
    },
    {
      recurso: "produtos_dados_fornecedor",
      acao: "ler fabricante e referência",
      esperado: SO_GERENCIA,
      rodar: linhasVisiveis("produtos_dados_fornecedor", "codigo", "99994"),
    },
    {
      recurso: "produtos",
      acao: "editar a descrição",
      esperado: SO_GERENCIA,
      rodar: async (p) =>
        ((
          await p.c
            .from("produtos")
            .update({ descricao: "SPOT MATRIZ" })
            .eq("codigo", "99994")
            .select("codigo")
        ).data?.length ?? 0) > 0,
    },
    {
      recurso: "buscar_por_referencia()",
      acao: "traduzir referência em código",
      esperado: TODOS_COM_PAPEL,
      rodar: funcaoFalha("buscar_por_referencia", () => ({ p_texto: "REF-MATRIZ-1" })),
    },
    // --- arquitetos
    {
      recurso: "arquitetos",
      acao: "ler arquiteto ativo",
      esperado: TODOS_COM_PAPEL,
      rodar: linhasVisiveis("arquitetos", "id", ids.arq),
    },
    {
      recurso: "arquitetos",
      acao: "ler arquiteto desativado",
      esperado: SO_GERENCIA,
      rodar: linhasVisiveis("arquitetos", "id", ids.arqI),
    },
    {
      recurso: "arquitetos",
      acao: "cadastrar arquiteto (em nome próprio)",
      esperado: TODOS_COM_PAPEL,
      rodar: async (p) => {
        const r = await p.c
          .from("arquitetos")
          .insert({ nome: "MATRIZ Novo", criado_por: p.id })
          .select("id");
        if (r.data?.[0]?.id) await admin.from("arquitetos").delete().eq("id", r.data[0].id);
        return !r.error;
      },
    },
    {
      recurso: "arquitetos",
      acao: "editar arquiteto",
      esperado: SO_GERENCIA,
      rodar: async (p) =>
        ((await p.c.from("arquitetos").update({ observacoes: "x" }).eq("id", ids.arq).select("id"))
          .data?.length ?? 0) > 0,
    },
    {
      recurso: "juntar_arquitetos()",
      acao: "juntar duplicados",
      esperado: SO_GERENCIA,
      rodar: passaPermissao("juntar_arquitetos", () => ({ p_manter: ids.arq, p_remover: ids.arq })),
    },
    {
      recurso: "juntar_clientes()",
      acao: "juntar clientes",
      esperado: SO_GERENCIA,
      rodar: passaPermissao("juntar_clientes", () => ({ p_manter: ids.cliA, p_remover: ids.cliK })),
    },
    // --- comissões: só o dono
    {
      recurso: "comissoes",
      acao: "ler comissão",
      esperado: SO_DONO,
      rodar: linhasVisiveis("comissoes", "id", ids.com),
    },
    {
      recurso: "configuracoes_comissao",
      acao: "ler percentuais",
      esperado: SO_DONO,
      rodar: async (p) =>
        ((await p.c.from("configuracoes_comissao").select("id")).data?.length ?? 0) > 0,
    },
    {
      recurso: "configuracoes_comissao",
      acao: "alterar percentuais",
      esperado: SO_DONO,
      rodar: async (p) =>
        ((
          await p.c
            .from("configuracoes_comissao")
            .update({ percentual_vendedora_padrao: 3 })
            .eq("id", true)
            .select("id")
        ).data?.length ?? 0) > 0,
    },
    {
      recurso: "comissoes_*_percentual",
      acao: "ler percentuais próprios",
      esperado: SO_DONO,
      rodar: async (p) =>
        !(await p.c.from("comissoes_arquiteto_percentual").select("arquiteto_id")).error &&
        ((await p.c.from("comissoes_arquiteto_percentual").select("arquiteto_id")).data?.length ??
          0) > 0,
    },
    {
      recurso: "calcular_fechamentos_anteriores()",
      acao: "calcular comissões anteriores",
      esperado: SO_DONO,
      rodar: funcaoFalha("calcular_fechamentos_anteriores", () => ({ p_gravar: false })),
    },
    // --- gestão e auditoria
    {
      recurso: "usuarios",
      acao: "ler as contas dos outros",
      esperado: SO_GERENCIA,
      rodar: async (p) =>
        ((await p.c.from("usuarios").select("id").eq("id", kely)).data?.length ?? 0) > 0 &&
        p.id !== kely,
    },
    {
      recurso: "configuracoes_loja",
      acao: "ler configurações",
      esperado: TODOS_COM_PAPEL,
      rodar: async (p) =>
        ((await p.c.from("configuracoes_loja").select("id")).data?.length ?? 0) > 0,
    },
    {
      recurso: "configuracoes_loja",
      acao: "alterar configurações",
      esperado: SO_GERENCIA,
      rodar: async (p) =>
        ((
          await p.c
            .from("configuracoes_loja")
            .update({ validade_dias: 7 })
            .eq("id", true)
            .select("id")
        ).data?.length ?? 0) > 0,
    },
    {
      recurso: "uso_ia",
      acao: "ler uso e custo da IA",
      esperado: SO_GERENCIA,
      rodar: async (p) =>
        !(await p.c.from("uso_ia").select("id").limit(1)).error &&
        ((await p.c.from("uso_ia").select("id")).data?.length ?? 0) > 0,
    },
    {
      recurso: "sync_estoque",
      acao: "ler cargas do estoque",
      esperado: SO_GERENCIA,
      rodar: async (p) => ((await p.c.from("sync_estoque").select("id")).data?.length ?? 0) > 0,
    },
    {
      recurso: "eventos_exportacao",
      acao: "ler auditoria de exportações (a da Aline)",
      esperado: E(true, false, true, true, false),
      rodar: async (p) =>
        ((await p.c.from("eventos_exportacao").select("id").limit(1)).data?.length ?? 0) > 0,
    },
    {
      recurso: "custo_ia_orcamentos()",
      acao: "custo da IA no período",
      esperado: SO_GERENCIA,
      rodar: funcaoFalha("custo_ia_orcamentos", () => ({
        p_inicio: "2026-11-01",
        p_fim: "2026-11-30",
      })),
    },
    {
      recurso: "erros_app",
      acao: "ler registro de erros",
      esperado: SO_GERENCIA,
      rodar: async (p) =>
        ((await p.c.from("erros_app").select("id").eq("mensagem", "matriz")).data?.length ?? 0) > 0,
    },
    // --- funções sobre o orçamento dos outros
    {
      recurso: "mudar_status_orcamento()",
      acao: "mudar status do orçamento da Aline",
      esperado: E(true, false, true, true, false),
      rodar: passaPermissao("mudar_status_orcamento", () => ({
        p_orcamento: ids.orcA,
        p_para: "enviado",
      })),
    },
    {
      recurso: "marcar_enviado()",
      acao: "marcar enviado o orçamento da Kely",
      esperado: E(false, true, true, true, false),
      rodar: passaPermissao("marcar_enviado", () => ({ p_orcamento: ids.orcK })),
    },
    {
      recurso: "renovar_validade()",
      acao: "renovar validade do orçamento da Aline",
      esperado: E(true, false, true, true, false),
      rodar: passaPermissao("renovar_validade", () => ({
        p_orcamento: ids.orcA,
        p_pdf_caminho: "x",
        p_xlsx_caminho: "x",
        p_versao: 9,
        p_total_esperado: 1,
        p_validade: "2026-12-31",
      })),
    },

    // --- arquivos (Storage): nem com o caminho exato
    {
      recurso: "Storage: anexos",
      acao: "baixar anexo da Aline (caminho exato)",
      esperado: E(true, false, true, true, false),
      rodar: (p) => baixa("anexos", `${aline}/${ids.orcA}/a.jpg`)(p),
    },
    {
      recurso: "Storage: pdfs",
      acao: "baixar PDF/XLSX da Aline (caminho exato)",
      esperado: E(true, false, true, true, false),
      rodar: (p) => baixa("pdfs", `${aline}/${ids.orcA}/a.pdf`)(p),
    },
    {
      recurso: "Storage: arquitetos (fotos)",
      acao: "baixar foto direto do bucket",
      esperado: NINGUEM,
      rodar: baixa("arquitetos", "matriz/foto.jpg"),
    },
  ];
}

// ---------------------------------------------------------------- execução
await limpar();
const resultados: { c: Celula; real: Record<Perfil, boolean | "erro"> }[] = [];
let falhas = 0;
try {
  await criarFixtures();
  for (const c of montar()) {
    const real = {} as Record<Perfil, boolean | "erro">;
    for (const perfil of PERFIS) {
      try {
        real[perfil] = await c.rodar(pessoas[perfil]);
      } catch {
        real[perfil] = "erro";
      }
    }
    resultados.push({ c, real });
    const ruins = PERFIS.filter(
      (p) => real[p] !== c.esperado[p] && !(real[p] === "erro" && c.esperado[p] === false),
    );
    if (ruins.length) {
      falhas++;
      console.error(
        `  FALHOU  ${c.recurso} · ${c.acao}\n    ${ruins.map((p) => `${p}: esperado ${c.esperado[p] ? "PODE" : "NÃO PODE"}, foi ${real[p] === true ? "PODE" : real[p] === false ? "NÃO PODE" : "erro"}`).join("; ")}`,
      );
    } else console.log(`  ok  ${c.recurso} · ${c.acao}`);
  }
} finally {
  await admin
    .from("configuracoes_comissao")
    .update({
      percentual_arquiteto_padrao: null,
      percentual_vendedora_padrao: null,
      percentual_vendedora_com_arquiteto: null,
    })
    .eq("id", true);
  await limpar();
  await admin.auth.admin.deleteUser(criada.data.user!.id);
}

if (process.argv.includes("--docs")) {
  const sim = (v: boolean | "erro") => (v === true ? "pode" : "—");
  const linhas = [
    "# Permissões por perfil",
    "",
    "Gerada por `pnpm test:rls -- --docs` a partir da matriz real (`scripts/testar-matriz.mts`): cada célula foi testada com o token de cada perfil, direto pela API do Supabase. **pode** = consegue; **—** = é barrado (a consulta volta vazia ou com erro).",
    "",
    "Perfis: **Aline/Kely** = vendedoras; **Gerente**; **Dono** (Seu Filipe: tudo da gerência + comissões); **Sem papel** = conta criada no Auth sem linha em `usuarios` (o que um cadastro público conseguiria).",
    "",
    `| Recurso | Ação | ${PERFIS.join(" | ")} |`,
    `| --- | --- | ${PERFIS.map(() => "---").join(" | ")} |`,
    ...resultados.map(
      ({ c, real }) =>
        `| ${c.recurso} | ${c.acao} | ${PERFIS.map((p) => sim(real[p])).join(" | ")} |`,
    ),
    "",
    "## Rotas do Next (testadas no e2e)",
    "",
    "| Rota | Aline/Kely | Gerente | Dono |",
    "| --- | --- | --- | --- |",
    "| `/comissoes`, `/comissoes/ajustes`, `/comissoes/exportar` | 404 | 404 | pode |",
    "| `/gerencia/*` (Equipe, Estoque, Ajustes) | redireciona para `/` | pode | pode |",
    "| `/exportar` (base) | só os próprios dados, sem fabricante/referência | tudo, com Eventos, Arquitetos e fabricante/referência | igual à gerência |",
    "| `/orcamentos/[id]` e downloads de PDF/XLSX de outra vendedora | não encontrado | pode | pode |",
    "",
    "Comissão nunca aparece no PDF, no XLSX, nos painéis, na exportação da base, na Indicação da IA nem em logs.",
    "",
  ];
  writeFileSync("docs/permissoes.md", linhas.join("\n"));
  console.log("docs/permissoes.md gravado.");
}
console.log(
  falhas
    ? `\n${falhas} célula(s) da matriz fora do esperado.`
    : `\nMatriz: ${resultados.length} recursos × ${PERFIS.length} perfis, todas as células conferem.`,
);
process.exit(falhas ? 1 : 0);
