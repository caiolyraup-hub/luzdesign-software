import { z } from "zod";
import { TIPOS_CLIENTE, type TipoCliente } from "../dominio";

/** Versão do formato de orcamentos.respostas. Mude ao alterar as perguntas. */
export const VERSAO_RESPOSTAS = 1;

// ---------------------------------------------------------------- opções (docs/perguntas.md)

export interface Opcao<V extends string = string> {
  valor: V;
  rotulo: string;
  dica?: string;
}

export const OPCOES_TIPO_CLIENTE: Opcao<TipoCliente>[] = [
  { valor: "final", rotulo: "Cliente final" },
  { valor: "arquiteto", rotulo: "Arquiteto(a)" },
  { valor: "eletricista", rotulo: "Eletricista" },
  { valor: "construtora", rotulo: "Construtora" },
  { valor: "empresa", rotulo: "Empresa" },
];

export const OPCOES_USO_OBRA: Opcao[] = [
  { valor: "residencial", rotulo: "Residencial" },
  { valor: "comercial", rotulo: "Comercial" },
];
export const OPCOES_ESTADO_OBRA: Opcao[] = [
  { valor: "nova", rotulo: "Obra nova" },
  { valor: "reforma", rotulo: "Reforma" },
];

export const OPCOES_AMBIENTES: Opcao[] = [
  { valor: "sala", rotulo: "Sala" },
  { valor: "cozinha", rotulo: "Cozinha" },
  { valor: "quartos", rotulo: "Quartos" },
  { valor: "banheiros", rotulo: "Banheiros" },
  { valor: "varanda", rotulo: "Varanda" },
  { valor: "fachada", rotulo: "Fachada" },
  { valor: "loja", rotulo: "Loja" },
  { valor: "outro", rotulo: "Outro" },
];

export const OPCOES_LINHA: Opcao[] = [
  { valor: "tecnica", rotulo: "Técnica" },
  { valor: "decorativa", rotulo: "Decorativa" },
  { valor: "ambas", rotulo: "As duas" },
];

export const OPCOES_PRAZO: Opcao[] = [
  { valor: "pronta_entrega", rotulo: "Precisa de pronta-entrega" },
  { valor: "encomenda", rotulo: "Aceita encomenda", dica: "30 a 45 dias úteis" },
];

export const TIPOS_ANEXO = ["foto", "pdf", "planta", "print"] as const;
export type TipoAnexo = (typeof TIPOS_ANEXO)[number];
export const ROTULOS_TIPO_ANEXO: Record<TipoAnexo, string> = {
  foto: "Foto",
  pdf: "PDF",
  planta: "Planta",
  print: "Print",
};
export const MAX_ANEXOS = 4;
export const MAX_BYTES_ANEXO = 10 * 1024 * 1024;
export const MIME_ANEXO_ACEITOS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

// ---------------------------------------------------------------- WhatsApp

/**
 * Normaliza telefone brasileiro para +55DDDNÚMERO. Aceita "(82) 99999-1234", "82999991234",
 * "+55 82 99999-1234", "055 82...". Exige DDD. Devolve null se não parecer um telefone válido.
 */
export function normalizarWhatsapp(bruto: string): string | null {
  let d = bruto.replace(/\D/g, "");
  d = d.replace(/^0+/, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = d.slice(0, 2);
  if (!/^[1-9][1-9]$/.test(ddd)) return null;
  const numero = d.slice(2);
  if (numero.length === 9 && numero[0] !== "9") return null;
  if (numero.length === 8 && numero[0] === "0") return null;
  return `+55${ddd}${numero}`;
}

/** +5582999991234 -> (82) 99999-1234, para exibir. */
export function formatarWhatsapp(normalizado: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(normalizado);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : normalizado;
}

// ---------------------------------------------------------------- schemas (um por pergunta)

const texto = (min: number, max: number, obrigatorio: string) =>
  z
    .string({ error: obrigatorio })
    .trim()
    .min(min, obrigatorio)
    .max(max, `Use no máximo ${max} caracteres.`);

const textoOpcional = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string()
      .max(max, `Use no máximo ${max} caracteres.`)
      .nullish()
      .transform((v) => (v ? v : undefined)),
  );

const valoresDe = (opcoes: Opcao[]) => opcoes.map((o) => o.valor) as [string, ...string[]];

const enumDe = (opcoes: Opcao[], mensagem: string) =>
  z.enum(valoresDe(opcoes), { error: mensagem });

export const schemaClienteNome = z.object({
  cliente_nome: texto(2, 120, "Informe o nome do cliente."),
});

export const schemaClienteWhatsapp = z.object({
  cliente_whatsapp: z
    .string({ error: "Informe o WhatsApp do cliente." })
    .trim()
    .transform((v, ctx) => {
      const n = normalizarWhatsapp(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: "Informe um WhatsApp válido, com DDD." });
        return z.NEVER;
      }
      return n;
    }),
});

export const schemaTipoCliente = z
  .object({
    tipo_cliente: z.enum(TIPOS_CLIENTE as unknown as [string, ...string[]], {
      error: "Escolha o tipo de cliente.",
    }),
    /** O cliente veio indicado por um arquiteto (vale para qualquer tipo que não seja arquiteto). */
    indicacao_arquiteto: z.boolean().nullish(),
    arquiteto_indicador: textoOpcional(120),
  })
  .superRefine((v, ctx) => {
    const exige = v.tipo_cliente === "arquiteto" || v.indicacao_arquiteto === true;
    if (exige && !v.arquiteto_indicador) {
      ctx.addIssue({
        code: "custom",
        path: ["arquiteto_indicador"],
        message:
          v.tipo_cliente === "arquiteto"
            ? "Informe o nome do arquiteto(a)."
            : "Informe qual arquiteto(a) indicou.",
      });
    }
  })
  .transform((v) => {
    const exige = v.tipo_cliente === "arquiteto" || v.indicacao_arquiteto === true;
    return {
      tipo_cliente: v.tipo_cliente as TipoCliente,
      indicacao_arquiteto:
        v.tipo_cliente === "arquiteto" ? undefined : (v.indicacao_arquiteto ?? false),
      arquiteto_indicador: exige ? v.arquiteto_indicador : undefined,
    };
  });

export const schemaTipoObra = z.object({
  tipo_obra: z.object(
    {
      uso: enumDe(OPCOES_USO_OBRA, "Escolha residencial ou comercial."),
      estado: enumDe(OPCOES_ESTADO_OBRA, "Escolha obra nova ou reforma."),
    },
    { error: "Informe o tipo de obra." },
  ),
});

export const schemaAmbientes = z
  .object({
    ambientes: z
      .array(enumDe(OPCOES_AMBIENTES, "Ambiente inválido."), {
        error: "Escolha ao menos um ambiente.",
      })
      .min(1, "Escolha ao menos um ambiente.")
      .transform((a) => [...new Set(a)]),
    ambiente_outro: textoOpcional(120),
  })
  .superRefine((v, ctx) => {
    if (v.ambientes.includes("outro") && !v.ambiente_outro) {
      ctx.addIssue({
        code: "custom",
        path: ["ambiente_outro"],
        message: "Diga qual é o outro ambiente.",
      });
    }
  })
  .transform((v) => ({
    ambientes: v.ambientes,
    ambiente_outro: v.ambientes.includes("outro") ? v.ambiente_outro : undefined,
  }));

export const schemaPedido = z.object({
  pedido_cliente: texto(3, 8000, "Conte o que o cliente pediu."),
});

export const schemaLinha = z.object({
  linha: enumDe(OPCOES_LINHA, "Escolha a linha."),
});

export const schemaFaixa = z.object({
  faixa_investimento: textoOpcional(120),
});

export const schemaPrazo = z.object({
  prazo: enumDe(OPCOES_PRAZO, "Escolha o prazo."),
});

export const schemaObservacoes = z.object({
  observacoes: textoOpcional(2000),
});

// ---------------------------------------------------------------- as 10 perguntas como dados

export type TipoPergunta = "texto" | "telefone" | "cards" | "obra" | "multipla" | "textoLongo";

export interface Pergunta {
  /** Posição (1 a 10), igual a docs/perguntas.md e ao parâmetro ?passo=. */
  numero: number;
  /** Id estável; chave principal em orcamentos.respostas. */
  id: string;
  rotulo: string;
  dica?: string;
  tipo: TipoPergunta;
  obrigatoria: boolean;
  /** Chaves de respostas que esta pergunta grava. */
  campos: string[];
  schema: z.ZodType<Record<string, unknown>>;
  /** Rótulo curto para o resumo. */
  resumo: string;
}

export const PERGUNTAS: Pergunta[] = [
  {
    numero: 1,
    id: "cliente_nome",
    rotulo: "Qual é o nome do cliente?",
    tipo: "texto",
    obrigatoria: true,
    campos: ["cliente_nome"],
    schema: schemaClienteNome,
    resumo: "Cliente",
  },
  {
    numero: 2,
    id: "cliente_whatsapp",
    rotulo: "Qual é o WhatsApp do cliente?",
    dica: "Com DDD, por exemplo (82) 99999-1234.",
    tipo: "telefone",
    obrigatoria: true,
    campos: ["cliente_whatsapp"],
    schema: schemaClienteWhatsapp,
    resumo: "WhatsApp",
  },
  {
    numero: 3,
    id: "tipo_cliente",
    rotulo: "Que tipo de cliente é?",
    tipo: "cards",
    obrigatoria: true,
    campos: ["tipo_cliente", "indicacao_arquiteto", "arquiteto_indicador"],
    schema: schemaTipoCliente,
    resumo: "Tipo de cliente",
  },
  {
    numero: 4,
    id: "tipo_obra",
    rotulo: "Que tipo de obra é?",
    tipo: "obra",
    obrigatoria: true,
    campos: ["tipo_obra"],
    schema: schemaTipoObra,
    resumo: "Obra",
  },
  {
    numero: 5,
    id: "ambientes",
    rotulo: "Quais ambientes?",
    dica: "Pode marcar mais de um.",
    tipo: "multipla",
    obrigatoria: true,
    campos: ["ambientes", "ambiente_outro"],
    schema: schemaAmbientes,
    resumo: "Ambientes",
  },
  {
    numero: 6,
    id: "pedido_cliente",
    rotulo: "O que o cliente pediu?",
    dica: "Pode colar a mensagem do WhatsApp do cliente ou listar códigos.",
    tipo: "textoLongo",
    obrigatoria: true,
    campos: ["pedido_cliente"],
    schema: schemaPedido,
    resumo: "Pedido do cliente",
  },
  {
    numero: 7,
    id: "linha",
    rotulo: "Qual linha de produtos?",
    tipo: "cards",
    obrigatoria: true,
    campos: ["linha"],
    schema: schemaLinha,
    resumo: "Linha",
  },
  {
    numero: 8,
    id: "faixa_investimento",
    rotulo: "Quanto o cliente quer investir?",
    dica: 'Opcional. Escreva do jeito que o cliente falou, por exemplo "até 5 mil".',
    tipo: "texto",
    obrigatoria: false,
    campos: ["faixa_investimento"],
    schema: schemaFaixa,
    resumo: "Investimento",
  },
  {
    numero: 9,
    id: "prazo",
    rotulo: "Qual é o prazo?",
    tipo: "cards",
    obrigatoria: true,
    campos: ["prazo"],
    schema: schemaPrazo,
    resumo: "Prazo",
  },
  {
    numero: 10,
    id: "observacoes",
    rotulo: "Observações e condições especiais",
    dica: "Opcional. Desconto combinado, forma de pagamento, detalhes da obra.",
    tipo: "textoLongo",
    obrigatoria: false,
    campos: ["observacoes"],
    schema: schemaObservacoes,
    resumo: "Observações",
  },
];

export const TOTAL_PERGUNTAS = PERGUNTAS.length;
/** Passo do envio de anexos (depois da pergunta 10) e do resumo. */
export const PASSO_ANEXOS = TOTAL_PERGUNTAS + 1;
export const PASSO_RESUMO = TOTAL_PERGUNTAS + 2;

export function perguntaDoPasso(passo: number): Pergunta | undefined {
  return PERGUNTAS.find((p) => p.numero === passo);
}

// ---------------------------------------------------------------- respostas guardadas

export type Respostas = { versao?: number } & Record<string, unknown>;

/** Mensagens de erro por campo. */
export type ErrosCampos = Record<string, string>;

export type ResultadoValidacao =
  { ok: true; valores: Record<string, unknown> } | { ok: false; erros: ErrosCampos };

/** Valida os campos de UMA pergunta (null e "" contam como vazio). */
export function validarPergunta(
  pergunta: Pergunta,
  entrada: Record<string, unknown>,
): ResultadoValidacao {
  const limpo: Record<string, unknown> = {};
  for (const campo of pergunta.campos) {
    const v = entrada[campo];
    if (v !== null && v !== "" && v !== undefined) limpo[campo] = v;
  }
  const r = pergunta.schema.safeParse(limpo);
  if (r.success) return { ok: true, valores: r.data };

  const erros: ErrosCampos = {};
  for (const issue of r.error.issues) {
    const chave = String(issue.path[0] ?? pergunta.campos[0]);
    erros[chave] ??= issue.message;
  }
  return { ok: false, erros };
}

/** Pergunta respondida e válida? (opcionais sempre contam como ok). */
export function perguntaCompleta(pergunta: Pergunta, respostas: Respostas): boolean {
  if (!pergunta.obrigatoria) return true;
  return validarPergunta(pergunta, respostas).ok;
}

/** Número da primeira pergunta obrigatória ainda vazia ou inválida; null se todas estão ok. */
export function primeiroPassoPendente(respostas: Respostas): number | null {
  return PERGUNTAS.find((p) => !perguntaCompleta(p, respostas))?.numero ?? null;
}

/** Valida tudo e devolve as respostas normalizadas e versionadas, ou os erros por pergunta. */
export function validarRespostas(
  respostas: Respostas,
): { ok: true; respostas: Respostas } | { ok: false; pendentes: number[] } {
  const pendentes = PERGUNTAS.filter((p) => !perguntaCompleta(p, respostas)).map((p) => p.numero);
  if (pendentes.length > 0) return { ok: false, pendentes };

  const normalizadas: Respostas = { versao: VERSAO_RESPOSTAS };
  for (const p of PERGUNTAS) {
    const r = validarPergunta(p, respostas);
    if (r.ok) Object.assign(normalizadas, r.valores);
  }
  return { ok: true, respostas: normalizadas };
}

/** Campos de texto livre que podem ser gravados sem validar tudo (rascunho com debounce). */
export const CAMPOS_TEXTO_LIVRE: Record<string, number> = {
  cliente_nome: 120,
  arquiteto_indicador: 120,
  ambiente_outro: 120,
  pedido_cliente: 8000,
  faixa_investimento: 120,
  observacoes: 2000,
};

// ---------------------------------------------------------------- texto legível (resumo)

const rotuloDe = (opcoes: Opcao[], valor: unknown) =>
  opcoes.find((o) => o.valor === valor)?.rotulo ?? String(valor ?? "");

/** Resposta de uma pergunta em texto, para o resumo. Vazio se não respondida. */
export function resumirResposta(pergunta: Pergunta, r: Respostas): string {
  switch (pergunta.id) {
    case "cliente_nome":
      return String(r.cliente_nome ?? "");
    case "cliente_whatsapp":
      return r.cliente_whatsapp ? formatarWhatsapp(String(r.cliente_whatsapp)) : "";
    case "tipo_cliente": {
      if (!r.tipo_cliente) return "";
      const base = rotuloDe(OPCOES_TIPO_CLIENTE, r.tipo_cliente);
      return r.arquiteto_indicador
        ? `${base} · Arquiteto(a): ${String(r.arquiteto_indicador)}`
        : base;
    }
    case "tipo_obra": {
      const o = r.tipo_obra as { uso?: string; estado?: string } | undefined;
      return o?.uso && o?.estado
        ? `${rotuloDe(OPCOES_USO_OBRA, o.uso)} · ${rotuloDe(OPCOES_ESTADO_OBRA, o.estado)}`
        : "";
    }
    case "ambientes": {
      const lista = Array.isArray(r.ambientes) ? (r.ambientes as string[]) : [];
      return lista
        .map((a) =>
          a === "outro" && r.ambiente_outro
            ? `Outro: ${String(r.ambiente_outro)}`
            : rotuloDe(OPCOES_AMBIENTES, a),
        )
        .join(", ");
    }
    case "pedido_cliente":
      return String(r.pedido_cliente ?? "");
    case "linha":
      return r.linha ? rotuloDe(OPCOES_LINHA, r.linha) : "";
    case "faixa_investimento":
      return String(r.faixa_investimento ?? "");
    case "prazo":
      return r.prazo
        ? rotuloDe(OPCOES_PRAZO, r.prazo) + (r.prazo === "encomenda" ? " (30 a 45 dias úteis)" : "")
        : "";
    case "observacoes":
      return String(r.observacoes ?? "");
    default:
      return "";
  }
}
