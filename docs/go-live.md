# Go-live (terça, 24/11/2026): passo a passo

Ordem de trabalho para o dia ficar mecânico. **Nada aqui apaga sem o ok do dono do projeto**, e cada passo tem o comando, a conferência e como desfazer. Em todos: `pnpm deploy:conferir` no fim.

Situação de partida (piloto de 19/11 a 23/11): Aline e Kely usam as **contas de teste delas** (`+aline` e `+kely`) com clientes de verdade. Os orçamentos criados por essas contas a partir de 19/11 00:00 (Maceió) ficam marcados `orcamentos.piloto = true`: contam nos números e o `golive:limpar` **nunca** os apaga. A gerência pode marcar ou desmarcar um orçamento à mão (`marcar_piloto`).

## A ordem certa (resumo)

1. Backup antes
2. Importar o estoque real
3. **Criar as contas reais**
4. **Transferir o piloto** para as contas reais (`contas:transferir`)
5. Conferir a transferência
6. **Só então limpar** (`golive:limpar`)
7. Apagar as contas de teste
8. Passar as contas Vercel, Supabase e OpenAI para a Luz Design
9. Conferir as configurações da loja
10. Backup depois
11. `pnpm deploy:conferir`

Limpar antes de transferir apagaria a história de teste junto com a conta; transferir antes de criar a conta real não é possível. Por isso a ordem acima.

## 1. Backup antes (obrigatório)

- **Comando:** `pnpm backup` (só lê a produção; sem Docker e sem `pg_dump`). Salva em `dados/backups/AAAA-MM-DD-HHMM/` (fora do git): um JSON por tabela (lido em lotes de 1.000), os arquivos do Storage (anexos, PDFs, XLSX, fotos de arquitetos e relatos) com o mesmo caminho, as contas do Auth (sem senhas, a API não as entrega) e o `manifesto.json` (contagem de linhas por tabela, tamanho e soma de verificação, commit e última migration). Rode fora do horário de uso.
- **Conferência:** `pnpm backup:conferir dados/backups/<pasta>` confere os arquivos pelo manifesto, **restaura tudo num Postgres local em memória** com as migrations do repositório e compara a contagem de cada tabela e a quantidade e o valor dos orçamentos por status. Só siga se terminar com "Backup conferido".
- **Guardar** a pasta fora desta máquina (por exemplo, no Google Drive da loja). Ela tem dados de clientes.
- **Simular restauração:** `pnpm backup:restaurar <pasta> --simular` (contra o projeto de testes, nunca grava). Restaurar na produção **não existe** de propósito: se um dia for preciso, planeje com o Caio e use um projeto novo.
- **Desfazer:** não se aplica (só leitura). Limite conhecido: as senhas das contas não entram no backup; contas restauradas precisam de senha nova.

## 2. Importar o estoque real

**Recebi a planilha → importar → conferir** (feito pela tela, pela gerência ou pelo dono; 23/11 é o dia previsto):

1. **Antes de tudo**, faça o backup (passo 1) e abra a planilha no Excel só para olhar o cabeçalho (códigos de 1 a 5 dígitos, preço com vírgula ou ponto, uma linha por produto).
2. Entre como gerência → **Estoque** → escolha o arquivo (XLSX ou CSV). O sistema sugere o mapeamento das colunas pelos nomes mais comuns (Código/Cód., Descrição, Preço/Preço de Venda/Valor Venda, Estoque/Qtde Estoque/Saldo, Grupo/Seção/Categoria, Marca/Fabricante, Und/Unid, Modelo, Referência do fabricante). Confira cada coluna sugerida; corrija o que estiver errado. O mapeamento fica salvo para a próxima carga.
3. **Prévia**: veja quantos produtos entram, quantos mudam de preço e quantos erros (linha e motivo). Código inválido, preço vazio ou texto no preço aparecem como erro e a linha é pulada; as outras entram. Só marque "desativar ausentes" se a planilha for o estoque **inteiro**.
4. **Confirmar**. A carga é gravada com a origem `estoque_real:<nome do arquivo>`. As descrições **editadas à mão** na tela Produtos são mantidas (a importação não as sobrescreve).
5. **Conferência** (nesta ordem):
   - Estoque → "Última carga": origem `estoque_real:…`, linhas gravadas = linhas válidas, erros esperados.
   - Produtos (gerência): o aviso âmbar "ATENÇÃO: catálogo provisório" virou o aviso verde "Catálogo importado (estoque_real:…)".
   - Na revisão de um orçamento da vendedora a faixa "Catálogo provisório: confira os preços antes de enviar" **não aparece mais** (a regra: existe uma carga terminada cuja origem não começa com "provisorio").
   - Procure 5 produtos conhecidos pelo código e confira preço e descrição. Verifique um produto com descrição editada: continua editada.
   - Gere um orçamento de teste (cliente "TESTE ...") e confira os preços no PDF.

- **Desfazer:** reimporte a planilha anterior (os preços voltam). O orçamento já gerado guarda preço e descrição congelados e não muda. Se a planilha estiver errada, **não desative ausentes**: produtos fora da planilha ficam como estão.
- **Pronta para a planilha?** O importador foi conferido com cabeçalhos típicos de sistemas de estoque (testes em `src/lib/estoque`), mas o formato real da loja ainda não foi visto: se alguma coluna não for reconhecida, mapeie à mão na prévia.

## 3. Criar as contas reais

- **Comando:** preencher `REAL_EMAIL_ALINE`, `REAL_EMAIL_KELY`, `REAL_EMAIL_GERENCIA` e `REAL_EMAIL_DONO` no `.env.local`; rodar `pnpm usuarios:reais` (simulação) e, se estiver certo, `pnpm usuarios:reais --criar`. A senha provisória de cada conta aparece **uma vez** no terminal; cada pessoa troca no primeiro login.
- **Conferência:** `pnpm usuarios:reais` mostra as quatro contas existentes; login de cada uma cai em `/trocar-senha`.
- **Desfazer:** apagar a conta criada (Auth e linha em `usuarios`) enquanto ela ainda não tem orçamento.
- O cadastro público do Supabase fica **fechado** (`pnpm deploy:conferir` falha se abrir). A criação é só por este script.

## 4. Transferir o piloto

- **Comando (simulação, a única que existe hoje):**
  `pnpm contas:transferir --de <e-mail +aline> --para <e-mail real da Aline> --simular`, e o mesmo para a Kely.
- **O que a execução real fará** (será ligada no dia, com o ok do dono): mover os arquivos no Storage (`<conta>/<orçamento>/...`), chamar `transferir_piloto(executar)` numa transação (orçamentos, clientes, itens, anexos, eventos, IA, comissões da vendedora e caminhos dos arquivos) e comparar a contagem antes e depois.
- **Conferência:** a contagem `antes` bate com `depois`; a conta real enxerga os orçamentos e a conta de teste não; um PDF antigo ainda abre.
- **Desfazer:** a função aceita a transferência inversa (`--de` real `--para` teste). Se algo falhar no meio, a transação do banco volta sozinha; só os arquivos movidos no Storage precisam ser devolvidos pelo mesmo comando.
- A função recusa quando um cliente do piloto também tem orçamento de teste: nesse caso, resolver (marcar ou desmarcar) antes.

## 5. Conferir a transferência

- **Comando:** `pnpm piloto:resumo <data de um dia do piloto>` e `pnpm testes:sobras`.
- **Conferência:** os números do piloto são os mesmos de antes, agora no nome das contas reais; nenhuma linha de orçamento piloto ficou na conta de teste.

## 6. Limpar os testes (só depois da transferência)

- **Comando:** `pnpm golive:limpar --simular`. A execução real **não existe ainda** e só será criada com o ok do dono. Ela apaga, nesta ordem: orçamentos de teste, clientes de teste, arquitetos de teste, reinicia o contador de numeração e zera `uso_ia`/exportações de teste.
- **Conferência:** a simulação lista também os **protegidos** (piloto, e os clientes e arquitetos ligados a ele). Revisar a lista inteira com o dono, em especial os orçamentos "criados antes do piloto sem marcador de teste" (2026-0006, 0007, 0008 e 0011 hoje) e o 2026-0005 (guardado de propósito).
- **Desfazer:** não desfaz. Por isso o passo 1 (backup) vem antes.

## 7. Apagar as contas de teste

- **Comando:** pelo Auth (Supabase) ou por script, removendo as quatro contas `+aline`, `+kely`, `+gerencia`, `+dono` **depois** de a transferência estar conferida e de a limpeza ter rodado.
- **Conferência:** `pnpm golive:limpar --simular` mostra 0 contas de teste; login das contas de teste falha.
- **Desfazer:** recriar a conta; os dados já foram transferidos.

## 8. Passar as contas Vercel, Supabase e OpenAI para a Luz Design

- **Vercel:** transferir o projeto (ou adicionar a conta da loja como dona); depois reconectar o repositório.
- **Supabase:** transferir a organização do projeto `luz-design-orcamentos`; confirmar que a URL e as chaves não mudam.
- **OpenAI:** criar a chave na conta da loja, trocar `OPENAI_API_KEY` na Vercel, redeploy e revogar a chave antiga.
- **Conferência:** `pnpm env:verificar`, `pnpm deploy:conferir` e uma Indicação da IA de teste feita pela gerência.
- **Desfazer:** voltar a chave antiga na Vercel (enquanto não revogada).

## 9. Configurações da loja

- **Comando:** gerência, **Ajustes**: nome, CNPJ, endereço, telefone, WhatsApp, rodapé, validade (7 dias), desconto à vista (10%) e percentuais de comissão (definidos pelo dono).
- **Conferência:** gerar um PDF de verificação (orçamento marcado como teste) e ler o cabeçalho e o rodapé.
- **Desfazer:** os valores anteriores ficam no histórico do Ajustes; os orçamentos já gerados não mudam.

## 10. Backup depois (obrigatório)

- **Comando:** `pnpm backup` e `pnpm backup:conferir dados/backups/<pasta>`, como no passo 1.
- **Conferência:** o manifesto "depois" tem os orçamentos do piloto (agora nas contas reais) e nenhum de teste; compare com o manifesto "antes": só deve ter diminuído o que a limpeza apagou.

## 11. Conferência final

- **Comando:** `pnpm deploy:conferir`, `pnpm test:rls` (roda no projeto de testes, nunca na produção; ver `docs/testes.md`) e `pnpm piloto:resumo`.
- **Conferência:** `deploy:conferir` verde (commit, migrations e cadastro público fechado).

---

## Anexo: simulação do `pnpm golive:limpar --simular` em 18/11/2026

Nada foi apagado. Ainda não há orçamento piloto (o piloto começa em 19/11 00:00). Os e-mails das contas foram omitidos.

```text
SIMULAÇÃO do go-live: nada foi apagado.

Orçamentos de teste (6):
  2026-0001 [Aline] — respostas.teste; cliente "TESTE Cliente A de Aline"
  2026-0002 [Aline] — respostas.teste; cliente "TESTE Cliente B de Aline"
  2026-0003 [Kely] — respostas.teste; cliente "TESTE Cliente A de Kely"
  2026-0004 [Kely] — respostas.teste; cliente "TESTE Cliente B de Kely"
  2026-0005 [Aline] — orçamento 2026-0005 (guardado de propósito até o go-live)
  2026-0010 [Gerência] — cliente "teste"

Clientes de teste (5):
  TESTE Cliente A de Aline
  TESTE Cliente B de Aline
  TESTE Cliente A de Kely
  TESTE Cliente B de Kely
  teste

Arquitetos de teste (1):
  Mario Gama Teste

PROTEGIDOS, não entram na limpeza (piloto + o que depende deles): 0 orçamento(s), 0 cliente(s), 0 arquiteto(s)

Contas de teste (4) — a senha inicial é a mesma das quatro; trocar/remover no go-live:
  Aline (vendedora) <e-mail da conta>
  Kely (vendedora) <e-mail da conta>
  Gerência (gerente) <e-mail da conta>
  Dono (dono) <e-mail da conta>

Produtos suspeitos de teste (0):

Orçamentos criados ANTES do piloto, sem marcador de teste no nome (4) — confirmar com o dono; são das contas de teste:
  2026-0006 [gerado] Aline — cliente "Caio teste"
  2026-0007 [enviado] Aline — cliente "Gabriel"
  2026-0008 [fechado] Aline — cliente "lula da silva"
  2026-0011 [rascunho] Gerência — cliente "dsgdghfjyuk"

Registros de uso da IA (uso_ia): 30 (custos dos testes; zerar o painel de custo no go-live)
Auditoria de exportações (eventos_exportacao) de contas de teste: 9

Arquivos no Storage (incluem órfãos de orçamentos já apagados; os de orçamento piloto ficam):
  anexos: 3 arquivo(s)
  pdfs: 8 arquivo(s)
  arquitetos: 0 arquivo(s)
  relatos: 0 arquivo(s)

Cache de descrições da IA (produtos_descricao_formatada): 6 linha(s), geradas por testes com a IA real; são refeitas sozinhas (limpar é opcional).

Ordem no go-live (docs/go-live.md): criar as contas reais -> pnpm contas:transferir (piloto) -> conferir -> SÓ ENTÃO limpar: orçamentos -> clientes -> arquitetos de teste, reiniciar o contador e remover as contas de teste.
```
