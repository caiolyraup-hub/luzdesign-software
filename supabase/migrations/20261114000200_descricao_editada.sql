-- Dia 12B: a gerência e o dono editam a descrição comercial de um produto. A edição à mão é
-- prioritária: a importação do estoque e o limpador (pnpm catalogo:proteger) não a sobrescrevem.
alter table produtos add column descricao_editada_em timestamptz;
