import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import Link from "next/link";
import { AcoesRelato } from "@/components/relatos/AcoesRelato";
import { ResumoDia } from "@/components/relatos/ResumoDia";
import { ehGerencia } from "@/lib/dominio";
import { obterUsuarioAtual } from "@/lib/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { EsqueletoLista } from "@/components/ui/Esqueleto";

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Maceio",
});

interface Linha {
  id: string;
  criado_em: string;
  tela: string | null;
  mensagem: string;
  foto_path: string | null;
  status: "aberto" | "resolvido";
  usuarios: { nome: string } | { nome: string }[] | null;
}

async function Lista({ searchParams }: Pick<PageProps<"/relatos">, "searchParams">) {
  await connection();
  const usuario = await obterUsuarioAtual();
  if (!ehGerencia(usuario.perfil)) notFound();
  const { status, dia } = await searchParams;
  const aba = Array.isArray(status) ? status[0] : status;
  const filtro = aba === "resolvidos" ? "resolvido" : "aberto";
  const supabase = await criarClienteServidor();
  const abas = (
    <nav aria-label="Filtro" className="grid grid-cols-3 gap-2">
      {(
        [
          ["aberto", "Abertos", "/relatos"],
          ["resolvido", "Resolvidos", "/relatos?status=resolvidos"],
          ["resumo", "Resumo do dia", "/relatos?status=resumo"],
        ] as const
      ).map(([v, r, href]) => (
        <Link
          key={v}
          href={href}
          aria-current={(aba === "resumo" ? "resumo" : filtro) === v ? "page" : undefined}
          className="flex min-h-12 items-center justify-center rounded-lg border border-zinc-300 px-1 text-center text-base aria-[current=page]:border-amber-700 aria-[current=page]:bg-amber-50 aria-[current=page]:font-semibold"
        >
          {r}
        </Link>
      ))}
    </nav>
  );
  if (aba === "resumo") {
    return (
      <div className="space-y-4">
        {abas}
        <ResumoDia dia={Array.isArray(dia) ? dia[0] : dia} />
      </div>
    );
  }

  const { data } = await supabase
    .from("relatos_piloto")
    .select(
      "id, criado_em, tela, mensagem, foto_path, status, usuarios!relatos_piloto_usuario_id_fkey(nome)",
    )
    .eq("status", filtro)
    .order("criado_em", { ascending: false })
    .limit(100);
  const linhas = (data ?? []) as unknown as Linha[];
  const caminhos = linhas.map((l) => l.foto_path).filter((c): c is string => Boolean(c));
  const urls = new Map<string, string>();
  if (caminhos.length) {
    const { data: assinadas } = await supabase.storage
      .from("relatos")
      .createSignedUrls(caminhos, 300);
    for (const u of assinadas ?? []) if (u.path && u.signedUrl) urls.set(u.path, u.signedUrl);
  }

  return (
    <div className="space-y-4">
      {abas}
      {linhas.length === 0 ? (
        <p className="text-lg text-zinc-600">
          Nenhum relato {filtro === "aberto" ? "em aberto" : "resolvido"}.
        </p>
      ) : (
        <ul className="space-y-3">
          {linhas.map((l) => {
            const quem = Array.isArray(l.usuarios) ? l.usuarios[0] : l.usuarios;
            const foto = l.foto_path ? urls.get(l.foto_path) : null;
            return (
              <li key={l.id} className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4">
                <p className="text-base text-zinc-600">
                  {quem?.nome ?? "—"} · {dataHora.format(new Date(l.criado_em))}
                  {l.tela ? ` · ${l.tela}` : ""}
                </p>
                <p className="text-lg whitespace-pre-wrap">{l.mensagem}</p>
                {foto ? (
                  <a href={foto} target="_blank" rel="noopener" className="block text-lg underline">
                    Ver foto da tela
                  </a>
                ) : null}
                <AcoesRelato id={l.id} status={l.status} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function Page({ searchParams }: PageProps<"/relatos">) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Relatos do piloto</h1>
      <Suspense fallback={<EsqueletoLista />}>
        <Lista searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
