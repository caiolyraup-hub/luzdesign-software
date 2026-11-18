// Auditoria (somente leitura): o que os testes (e2e e test:rls) deixaram no banco e no Storage de
// produção, e se `pnpm golive:limpar --simular` cobre. Uso: pnpm testes:sobras
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const MARCAS =
  /^(teste|jornada e2e|com e2e|com rls|arq rls|matriz|cliente rls|export e2e|relato e2e|troca senha)/i;
const resultado: { onde: string; n: number; exemplos: string[] }[] = [];
const registrar = (onde: string, itens: string[]) =>
  resultado.push({ onde, n: itens.length, exemplos: itens.slice(0, 4) });

const { data: clientes } = await admin.from("clientes").select("id, nome");
const clientesTeste = (clientes ?? []).filter((c) => MARCAS.test(c.nome));
registrar(
  "clientes de teste",
  clientesTeste.map((c) => c.nome),
);
const idsCli = new Set(clientesTeste.map((c) => c.id));

const { data: orcs } = await admin
  .from("orcamentos")
  .select("id, numero, status, cliente_id, respostas");
const orcTeste = (orcs ?? []).filter(
  (o) =>
    idsCli.has(o.cliente_id) || (o.respostas as Record<string, unknown> | null)?.teste === true,
);
registrar(
  "orçamentos de teste",
  orcTeste.map((o) => `${o.numero} [${o.status}]`),
);
const idsOrc = new Set(orcTeste.map((o) => o.id));
const reais = (orcs ?? []).filter((o) => !idsOrc.has(o.id));
registrar(
  "orçamentos que NÃO são de teste (reais)",
  reais.map((o) => `${o.numero} [${o.status}]`),
);

const { data: arqs } = await admin.from("arquitetos").select("nome");
registrar(
  "arquitetos de teste",
  (arqs ?? []).filter((a) => /teste|e2e|rls|matriz|jornada/i.test(a.nome)).map((a) => a.nome),
);
const { data: rel } = await admin.from("relatos_piloto").select("mensagem");
registrar(
  "relatos de teste",
  (rel ?? []).filter((r) => /^(RELATO E2E|MATRIZ)/.test(r.mensagem)).map((r) => r.mensagem),
);
const { data: com } = await admin.from("comissoes").select("orcamento_id");
registrar(
  "comissões de orçamentos de teste",
  (com ?? []).filter((c) => idsOrc.has(c.orcamento_id)).map((c) => c.orcamento_id),
);
registrar(
  "comissões de orçamentos que não são de teste",
  (com ?? []).filter((c) => !idsOrc.has(c.orcamento_id)).map((c) => c.orcamento_id),
);
const { data: uso } = await admin.from("uso_ia").select("id, orcamento_id");
registrar(
  "uso_ia ligado a orçamento de teste (ou sem orçamento)",
  (uso ?? []).filter((u) => !u.orcamento_id || idsOrc.has(u.orcamento_id)).map((u) => u.id),
);
const { data: ind } = await admin.from("indicacoes_ia").select("id, orcamento_id");
registrar(
  "indicacoes_ia de orçamentos de teste",
  (ind ?? []).filter((i) => idsOrc.has(i.orcamento_id)).map((i) => i.id),
);
const { data: exp } = await admin.from("eventos_exportacao").select("id, usuario_id");
registrar(
  "eventos_exportacao (todos, de contas de teste)",
  (exp ?? []).map((e) => String(e.id)),
);
const { data: erros } = await admin.from("erros_app").select("id, mensagem");
registrar(
  "erros_app",
  (erros ?? []).map((e) => e.mensagem),
);
const { data: consultas } = await admin.from("consultas_referencia").select("id");
registrar(
  "consultas_referencia (janela de 1 h)",
  (consultas ?? []).map((c) => String(c.id)),
);
const { data: prod } = await admin
  .from("produtos")
  .select("codigo, descricao")
  .or("codigo.like.9999%");
registrar(
  "produtos de teste (código 9999x)",
  (prod ?? []).map((p) => `${p.codigo} ${p.descricao}`),
);
const { data: sync } = await admin.from("sync_estoque").select("origem");
registrar(
  "cargas de estoque de teste",
  (sync ?? []).filter((s) => /teste/i.test(s.origem)).map((s) => s.origem),
);
const { data: fmt } = await admin
  .from("produtos_descricao_formatada")
  .select("codigo, descricao_formatada");
registrar(
  "cache de descrições (linhas)",
  (fmt ?? []).map((f) => `${f.codigo}: ${f.descricao_formatada}`),
);

async function arquivos(bucket: string, pasta = ""): Promise<string[]> {
  const { data } = await admin.storage.from(bucket).list(pasta, { limit: 1000 });
  const saida: string[] = [];
  for (const o of data ?? []) {
    if (o.id) saida.push(`${pasta}${o.name}`);
    else saida.push(...(await arquivos(bucket, `${pasta}${o.name}/`)));
  }
  return saida;
}
for (const b of ["anexos", "pdfs", "arquitetos", "relatos"])
  registrar(`Storage: ${b} (arquivos)`, await arquivos(b));
const { data: contas } = await admin.auth.admin.listUsers({ perPage: 200 });
registrar(
  "contas no Auth que não são das 4 de teste",
  (contas?.users ?? []).map((u) => u.email ?? "").filter((e) => !/caiolyra\.up\+/.test(e)),
);
const { data: cfg } = await admin.from("configuracoes_comissao").select("*").single();
registrar(
  "percentuais de comissão preenchidos (deveriam estar vazios até o dono definir)",
  [
    cfg?.percentual_arquiteto_padrao,
    cfg?.percentual_vendedora_padrao,
    cfg?.percentual_vendedora_com_arquiteto,
  ]
    .filter((v) => v !== null && v !== undefined)
    .map(String),
);

console.log("AUDITORIA DE SOBRAS DOS TESTES (somente leitura)\n");
for (const r of resultado)
  console.log(
    `${String(r.n).padStart(4)}  ${r.onde}${r.exemplos.length ? `\n        ${r.exemplos.join("\n        ")}` : ""}`,
  );
