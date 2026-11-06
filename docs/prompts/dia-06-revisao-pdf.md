# Prompt do dia 6 (adiantado para 06/11/2026): tela de revisão e PDF com o design da Luz Design

## Antes de mandar (com você)

1. **Chave da OpenAI (ainda vazia no `.env.local`)**: não trava o dia de hoje, porque a revisão funciona também com itens adicionados à mão. Se quiser já testar a IA de verdade, preencha `OPENAI_API_KEY=` com `notepad .env.local` antes de mandar o prompt.
2. **Logo da loja**: se tiver o logo da Luz Design (PNG ou SVG, de preferência com fundo transparente), salve em `C:\Users\CaioLyra\luz-design-orcamentos\public\marca\logo.png` (ou `logo.svg`). Sem o logo, o PDF sai com o nome da loja escrito, e dá para trocar depois.

Depois mande para o Claude Code: **"Leia docs/prompts/dia-06-revisao-pdf.md e execute tudo."**

---

Hoje é o **dia 6 de 14** do projeto Luz Design Orçamentos (no plano original, 11/11). Leia o `CLAUDE.md` e os arquivos em `docs/`. Os dias 1 a 5 estão publicados: login com RLS, catálogo provisório, formulário com anexos e motor de IA, que grava itens em `orcamento_itens` e mostra o resultado em `/orcamentos/[id]/itens`.

**Passo 0:** se `OPENAI_API_KEY` estiver preenchida no `.env.local`, termine primeiro o que ficou do dia 5: liste os modelos da conta (`GET /v1/models`) e use `gpt-5.6` se existir; se não existir, me mostre os `gpt-5.x` disponíveis e pare para eu escolher. Preencha os preços por milhão de tokens a partir da página oficial de preços da OpenAI (diga a fonte), cadastre a chave e o modelo na Vercel sem mostrar a chave e rode `pnpm ia:testar`. Se a chave estiver vazia, pule este passo e siga, avisando no fim.

**Objetivo de hoje:** a vendedora revisa e ajusta os itens (os montados pela IA ou adicionados à mão) e toca em **Gerar PDF**. Sai um PDF bonito, com a cara da Luz Design, que ela compartilha no WhatsApp. O orçamento passa a `gerado`, com preços congelados e validade de 7 dias.

## Regras (não mude)

- Preço sempre vem de `produtos`. A vendedora **não** edita o preço de item com código; só o de **item avulso**, que precisa ter preço maior que 0 antes de gerar o PDF.
- Ao gerar o PDF, os preços e descrições são congelados nos itens e não mudam mais com o estoque.
- Valem as regras do `CLAUDE.md`: RLS, service role só no servidor, `<Suspense>` no Next 16, português, mobile-first.

## Tarefas

1. **Dados da loja (`/gerencia/configuracoes`)**
   - Crie, por migration, a tabela `configuracoes_loja` (uma linha só), com: nome_fantasia, razao_social, cnpj, endereco, telefone, whatsapp, instagram, site, validade_dias (padrão 7), desconto_avista_pct (padrão 10) e linhas_rodape (texto, uma por linha). RLS: todos os logados leem; só a gerente edita.
   - Valores iniciais: Luz Design / Luz Design LTDA / CNPJ 04.487.554/0001-16 / Av. Dr. Júlio Marques Luz, 753-C, Jatiúca, Maceió-AL. Rodapé: "À vista, desconto de 10%", "Orçamento válido por 7 dias", "Prazo de entrega: 30 a 45 dias úteis após o pagamento", "Não fazemos trocas de peças por encomenda", "Mercadoria frágil". Telefone, WhatsApp, Instagram e site ficam vazios. Não invente esses dados; a gerente preenche.
   - A tela de configurações deixa a gerente editar esses campos (formulário simples).

2. **Tela de revisão `/orcamentos/[id]/revisao`** (substitui a `/itens` provisória; redirecione `/itens` para ela)
   - Itens agrupados por **ambiente**, cada um com: descrição, código, marca, quantidade (com botões − e + e campo editável; `m` aceita decimais), unidade, preço unitário e subtotal.
   - Ações por item, com um toque: **Trocar produto** (abre a busca `buscar_produtos` e substitui mantendo quantidade e ambiente), **Mudar ambiente** e **Remover** (com desfazer por alguns segundos).
   - Por ambiente: **Adicionar produto** (busca) e **Adicionar item avulso** (descrição, quantidade e preço manual, destacado como "preço a definir" enquanto estiver 0).
   - Botão **Adicionar ambiente**.
   - Mostre a justificativa da IA de forma discreta, em "Por que este item?".
   - Mostre em destaque as pendências e os avisos da IA, quando houver.
   - Se o preço de algum produto mudou no catálogo depois da montagem, mostre o aviso "O preço de X itens mudou no estoque" com o botão **Atualizar preços**.
   - Rodapé fixo com total, total à vista (com o desconto configurado) e o botão principal **Gerar PDF**. Ele fica desabilitado, com o motivo, se houver item avulso com preço 0 ou nenhum item.
   - Cada alteração é salva na hora (server action), e o `valor_total` é recalculado no servidor.
   - Quem não tem chave de IA ou prefere montar sem ela: no Resumo, inclua também **Montar à mão**, que leva direto para a revisão vazia com os ambientes da pergunta 5.

3. **PDF (`src/lib/pdf/`)**
   - Use `@react-pdf/renderer`, que roda bem em função serverless (evite Chromium na Vercel).
   - Layout A4, inspirado no modelo de planilha que a loja usa hoje (veja a estrutura em `dados/orcamentos-37-extraidos.json`: cabeçalho com cliente, arquiteto, contato da vendedora e data; tabela QT | PRODUTO | DESCRIÇÃO | AMBIENTE | UNIT | TOTAL; rodapé com as condições). Agora, mais limpo:
     - **Cabeçalho:** o logo (`public/marca/logo.*`, se existir; senão "LUZ DESIGN" em tipografia elegante), os dados da loja de `configuracoes_loja`, "ORÇAMENTO Nº 2026-0005", a data e "Válido até DD/MM/AAAA".
     - **Bloco do cliente:** nome, WhatsApp, arquiteto (se houver) e a vendedora responsável.
     - **Itens agrupados por ambiente**, com subtítulo e subtotal por ambiente; colunas Qtd | Código | Descrição | Unit. | Total; item avulso sem código.
     - **Totais:** total, desconto à vista (%) e total à vista, em destaque.
     - **Condições:** as linhas do rodapé configuradas.
     - **Visual:** fundo branco, uma cor de destaque discreta (proponha uma, por exemplo um dourado ou âmbar sóbrio, e deixe-a em uma constante só, fácil de trocar), fonte sans-serif legível, valores em R$ no formato brasileiro (`R$ 1.234,56`), número de página e quebras de página sem cortar um item ao meio.
   - Teste com um orçamento de 60 itens para conferir a paginação.

4. **Gerar PDF (server action)**
   - Confirme que o orçamento é da vendedora logada e está em `rascunho` ou `gerado`.
   - Em uma transação: releia preços e descrições de `produtos`, grave nos campos congelados, recalcule `valor_total`, defina `status = 'gerado'`, `gerado_em = now()` e `validade = hoje + validade_dias`.
   - Gere o PDF e salve no Storage, num bucket privado novo `pdfs`, no caminho `{vendedora_id}/{orcamento_id}/{numero}-v{versao}.pdf`, com uma política igual à de `anexos` (a gerente só lê). Guarde em `orcamentos` o `pdf_caminho` e a `pdf_versao`.
   - Orçamento já `gerado` pode ser ajustado e gerar uma **nova versão**: aumenta `pdf_versao` e mantém as anteriores no Storage. A partir de `enviado` (dia 8), a edição fica bloqueada; isso entra no próximo prompt.

5. **Tela do orçamento `/orcamentos/[id]`**
   - Para `gerado`: prévia do PDF (ou a primeira página como imagem no celular), botão **Compartilhar no WhatsApp** (Web Share API com o arquivo PDF no celular; no computador, baixar o PDF e abrir `https://wa.me/55...` com uma mensagem curta pronta para o cliente), **Baixar PDF** e **Editar** (volta para a revisão e gera nova versão).
   - Linha do tempo com os eventos já registrados (criado, montado pela IA, PDF gerado).
   - O botão "Marquei como enviado" ainda **não** entra hoje.

6. **Testes**
   - Unitários: totais e desconto à vista, arredondamento em centavos, formatação de R$ e a regra de bloqueio do Gerar PDF (avulso com preço 0, nenhum item).
   - PDF: gere o PDF de um orçamento de teste e confira, extraindo o texto, o número, o total, o total à vista e as linhas do rodapé.
   - `pnpm test:rls`: Aline não lê PDF da Kely; a gerente lê, mas não grava; vendedora não edita `configuracoes_loja`; Aline não edita itens nem gera PDF de orçamento da Kely.
   - `pnpm test:e2e` (390 px): como Aline, criar orçamento, **Montar à mão**, adicionar 2 produtos pela busca e 1 avulso com preço, gerar o PDF, ver o status Gerado e baixar o PDF. Limpe tudo o que o teste criar.

7. **Fechamento**
   - Gere um PDF de exemplo com dados fictícios (cliente "TESTE") e salve em `dados/exemplo-orcamento.pdf` (fora do git), para eu ver o visual.
   - Atualize `docs/modelo-de-dados.md`, `docs/arquitetura.md` e `docs/plano.md` (dia 6).
   - `pnpm lint`, `pnpm test`, `pnpm test:rls`, `pnpm test:e2e` e `pnpm build` precisam passar. Aplique as migrations no remoto, faça o commit `feat: revisão de itens e PDF do orçamento (dia 6)` e o push, e confira o deploy.

## Fora do escopo de hoje

Status `enviado`, follow-up e perda (dia 8), painéis e desconto especial além do desconto à vista. Não apague os 4 orçamentos TESTE do seed.

Ao terminar, me mostre: o caminho do PDF de exemplo, a saída dos testes, a descrição das telas de revisão e do orçamento no celular, o resultado do passo 0 (ou que a chave segue vazia) e qualquer pendência.
