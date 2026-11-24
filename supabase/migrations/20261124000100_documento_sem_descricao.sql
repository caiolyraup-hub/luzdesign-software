-- Dia 16 (parte A): o PDF e o XLSX do orçamento mostram só o código do produto. A descrição volta com
-- um clique da gerência (Configurações), sem deploy. Padrão: desligado.
alter table configuracoes_loja
  add column documento_mostrar_descricao boolean not null default false;
