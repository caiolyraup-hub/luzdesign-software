"use server";

import { z } from "zod";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export interface EstadoConfiguracoes {
  ok: boolean | null;
  erro: string | null;
}

const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .transform((v) => (v === "" ? null : v));

const schema = z.object({
  nome_fantasia: z.string().trim().min(2, "Informe o nome da loja.").max(100),
  razao_social: texto(150),
  cnpj: texto(30),
  endereco: texto(250),
  telefone: texto(40),
  whatsapp: texto(40),
  instagram: texto(80),
  site: texto(150),
  validade_dias: z.coerce
    .number()
    .int("Use um número inteiro.")
    .min(1, "A validade é de 1 a 90 dias.")
    .max(90, "A validade é de 1 a 90 dias."),
  desconto_avista_pct: z.coerce
    .number()
    .min(0, "O desconto vai de 0 a 100%.")
    .max(100, "O desconto vai de 0 a 100%."),
  linhas_rodape: z.string().max(2000, "Use no máximo 2000 caracteres."),
});

/** Só a gerente edita (a RLS também garante: a vendedora não consegue atualizar a tabela). */
export async function salvarConfiguracoes(
  _anterior: EstadoConfiguracoes,
  formData: FormData,
): Promise<EstadoConfiguracoes> {
  const usuario = await obterUsuarioAtual();
  if (usuario.perfil !== "gerente")
    return { ok: false, erro: "Apenas a gerência pode alterar estes dados." };

  // O desconto aceita vírgula decimal ("12,5").
  const bruto = Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [
      k,
      typeof v === "string" ? (k === "desconto_avista_pct" ? v.replace(",", ".") : v) : "",
    ]),
  );
  const r = schema.safeParse(bruto);
  if (!r.success) return { ok: false, erro: r.error.issues[0].message };

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from("configuracoes_loja")
    .update({ ...r.data, linhas_rodape: r.data.linhas_rodape.replace(/\r\n/g, "\n").trim() })
    .eq("id", true)
    .select("id");
  if (error || !data?.length)
    return { ok: false, erro: "Não foi possível salvar agora. Tente de novo." };
  return { ok: true, erro: null };
}
