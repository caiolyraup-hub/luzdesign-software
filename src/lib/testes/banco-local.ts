// Postgres local em memória (PGlite) com as migrations reais e auth/storage simulados.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const PASTA_MIGRATIONS = path.resolve(import.meta.dirname, "../../../supabase/migrations");

export async function criarBancoLocal(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`
    create schema extensions; create schema auth; create schema storage;
    create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    grant usage on schema public, auth, extensions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);
  for (const arquivo of fs.readdirSync(PASTA_MIGRATIONS).sort()) {
    await db.exec(fs.readFileSync(path.join(PASTA_MIGRATIONS, arquivo), "utf8"));
  }
  return db;
}

/** Executa SQL como um usuário logado (papel authenticated, auth.uid() = id) e volta ao superusuário. */
export async function comoUsuario<T>(db: PGlite, id: string, sql: string, params: unknown[] = []) {
  await db.exec(
    `reset role; select set_config('request.jwt.claim.sub', '${id}', false); set role authenticated;`,
  );
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
