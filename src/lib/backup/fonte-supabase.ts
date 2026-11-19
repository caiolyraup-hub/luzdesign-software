import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContaAuth, FonteBackup, Linha } from "./nucleo";

/** Lê o banco e o Storage pela API, com a service role (só em scripts do servidor local). */
export function fonteSupabase(admin: SupabaseClient): FonteBackup {
  async function listar(bucket: string, pasta = ""): Promise<{ caminho: string }[]> {
    const saida: { caminho: string }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(bucket).list(pasta, { limit: 1000, offset });
      if (error) throw new Error(`Storage ${bucket}/${pasta}: ${error.message}`);
      for (const o of data ?? []) {
        if (o.id) saida.push({ caminho: `${pasta}${o.name}` });
        else saida.push(...(await listar(bucket, `${pasta}${o.name}/`)));
      }
      if ((data ?? []).length < 1000) break;
    }
    return saida;
  }
  return {
    async lerTabela(nome, ordem, de, quantidade) {
      const { data, error } = await admin
        .from(nome)
        .select("*")
        .order(ordem, { ascending: true })
        .range(de, de + quantidade - 1);
      if (error) throw new Error(`Tabela ${nome}: ${error.message}`);
      return (data ?? []) as Linha[];
    },
    async contasAuth() {
      const contas: ContaAuth[] = [];
      for (let pagina = 1; ; pagina++) {
        const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
        if (error) throw new Error(`Auth: ${error.message}`);
        for (const u of data.users)
          contas.push({
            id: u.id,
            email: u.email ?? null,
            criado_em: u.created_at ?? null,
            ultimo_login: u.last_sign_in_at ?? null,
            metadata: (u.user_metadata ?? null) as Record<string, unknown> | null,
          });
        if (data.users.length < 200) break;
      }
      return contas;
    },
    listarArquivos: (bucket) => listar(bucket),
    async baixarArquivo(bucket, caminho) {
      const { data, error } = await admin.storage.from(bucket).download(caminho);
      if (error || !data)
        throw new Error(`Storage ${bucket}/${caminho}: ${error?.message ?? "vazio"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async ultimaMigration() {
      const { data } = await admin.rpc("ultima_migration");
      return (data as string | null) ?? null;
    },
  };
}
