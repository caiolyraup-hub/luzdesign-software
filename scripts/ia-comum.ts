// Apoio dos scripts que chamam a IA de verdade (ia:testar e ia:avaliar): login como Aline, rascunhos de
// teste, pedidos de dados/avaliacao/pedidos.json e os orçamentos reais de comparação.
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { lerLinha, normalizarData } from "../src/lib/estoque/provisorio";

export function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável ${nome} ausente no .env.local`);
  return v;
}

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } };

export async function entrar(): Promise<{
  admin: SupabaseClient;
  aline: SupabaseClient;
  alineId: string;
}> {
  const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
  const admin = createClient(url, exigir("SUPABASE_SERVICE_ROLE_KEY"), opcoes);
  const aline = createClient(url, exigir("NEXT_PUBLIC_SUPABASE_ANON_KEY"), opcoes);
  const login = await aline.auth.signInWithPassword({
    email: exigir("SEED_EMAIL_ALINE"),
    password: exigir("SEED_SENHA_INICIAL"),
  });
  if (login.error || !login.data.user)
    throw new Error(`Login da Aline falhou: ${login.error?.message}`);
  return { admin, aline, alineId: login.data.user.id };
}

// ---------------------------------------------------------------- pedidos e casos

export interface PedidoBase {
  indice: number;
  tipo_cliente: string;
  tipo_obra: { uso: string; estado: string };
  ambientes: string[];
  ambiente_outro?: string;
  ambientes_originais: Record<string, string>;
  linha: string;
  faixa_investimento: string | null;
  prazo: string;
}

export interface CasoIndicacao {
  id: string;
  indice: number;
  ambiente: string;
  descricao: string;
  pedido_cliente: string;
  pedido_arquiteto: string;
  descricao_ambiente: string;
  categorias_esperadas: string[];
  exigencias: { categoria: string; w: number; k: number }[];
}

export function lerPedidos(): { pedidos: PedidoBase[]; indicacoes: CasoIndicacao[] } {
  return JSON.parse(readFileSync("dados/avaliacao/pedidos.json", "utf8"));
}

export interface LinhaOriginal {
  codigo: string;
  /** Ambiente do pedido (mapeado) a que a linha pertence. */
  ambiente: string;
  qt: number;
}

/** Linhas com código de um orçamento real, já ligadas ao ambiente do pedido. */
export function linhasOriginais(pedido: PedidoBase): LinhaOriginal[] {
  const reais = JSON.parse(readFileSync("dados/orcamentos-37-extraidos.json", "utf8")) as {
    date?: string;
    items?: string[][];
  }[];
  const o = reais[pedido.indice];
  const rotulo = (a: string) =>
    pedido.ambientes_originais[a] ?? pedido.ambientes_originais["?"] ?? "Geral";
  const resultado: LinhaOriginal[] = [];
  (o.items ?? []).forEach((it, k) => {
    const l = lerLinha(it, normalizarData(o.date), k);
    if (!("ocorrencia" in l)) return;
    resultado.push({
      codigo: l.ocorrencia.codigo,
      ambiente: rotulo(it.length >= 6 ? it[3] : "?"),
      qt: Number(it[0]),
    });
  });
  return resultado;
}

// ---------------------------------------------------------------- rascunhos de teste

export async function criarRascunho(
  aline: SupabaseClient,
  alineId: string,
  p: PedidoBase,
  rotuloTeste: string,
  extra: { arquiteto?: boolean; pedidoCliente?: string } = {},
): Promise<string> {
  const nome = `TESTE IA ${rotuloTeste}`;
  const whatsapp = `+55829000${String(2000 + p.indice).slice(-4)}`;
  const respostas = {
    versao: 2,
    teste_ia: "true",
    cliente_nome: nome,
    cliente_whatsapp: whatsapp,
    tipo_cliente: p.tipo_cliente,
    ...(extra.arquiteto ? { arquiteto_indicador: "Arquiteta (teste)" } : {}),
    ...(extra.pedidoCliente ? { pedido_cliente: extra.pedidoCliente } : {}),
    ...(p.faixa_investimento ? { faixa_investimento: p.faixa_investimento } : {}),
    prazo: p.prazo,
  };
  const cli = await aline
    .from("clientes")
    .insert({ vendedora_id: alineId, nome, whatsapp })
    .select("id")
    .single();
  if (cli.error) throw new Error(`Cliente de teste: ${cli.error.message}`);
  const orc = await aline
    .from("orcamentos")
    .insert({ vendedora_id: alineId, cliente_id: cli.data.id, respostas })
    .select("id")
    .single();
  if (orc.error) throw new Error(`Orçamento de teste: ${orc.error.message}`);
  return orc.data.id as string;
}

/** Apaga o que os testes criaram (uso_ia, indicações, orçamentos e clientes TESTE IA) e acerta o contador. */
export async function limparTestes(admin: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length) {
    await admin.from("uso_ia").delete().in("orcamento_id", ids);
    await admin.from("orcamentos").delete().in("id", ids); // indicacoes_ia sai em cascata
  }
  await admin.from("clientes").delete().like("nome", "TESTE IA%");
  const { data: n } = await admin.from("orcamentos").select("numero").like("numero", "2026-%");
  const maior = Math.max(0, ...(n ?? []).map((x) => Number(String(x.numero).slice(5))));
  await admin.from("orcamento_contador").update({ ultimo: maior }).eq("ano", 2026);
}

export const usd = (n: number) => `US$ ${n.toFixed(4)}`;
export const moeda = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
