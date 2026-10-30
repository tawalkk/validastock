# ValidaStock

Aplicação web responsiva de controle de validade, conectada ao Supabase.

## Preparar o Supabase

1. Abra o **SQL Editor** do seu projeto Supabase.
2. Execute o conteúdo de `supabase-schema.sql` uma vez para criar as tabelas, políticas RLS e funções transacionais.
3. Em **Authentication → URL Configuration**, permita a URL local/de publicação para confirmação de conta.
4. Em **Authentication → Providers → Email**, escolha se o cadastro exige confirmação por e-mail.

A URL e a chave publishable estão em `supabase-config.js`. A chave publishable pode ficar no navegador; nunca coloque uma chave `service_role` ou secret nesse projeto. O acesso às tabelas é restrito por políticas RLS para a conta autenticada.

### Consulta ao Bluesoft Cosmos

A busca por GTIN consulta primeiro o Open Food Facts e depois a Bluesoft Cosmos. O token Cosmos e o User-Agent são usados somente pela função `cosmos-gtin` no Supabase; não os coloque em `app.js`, `supabase-config.js` ou no GitHub.

1. Na conta Bluesoft Cosmos, obtenha o token da API e o User-Agent exibidos na página oficial da API.
2. No Supabase, abra **Project Settings → Edge Functions → Secrets** e cadastre `BLUESOFT_COSMOS_TOKEN` e `BLUESOFT_COSMOS_USER_AGENT`.
3. Implante a função do diretório `supabase/functions/cosmos-gtin` com a Supabase CLI: `supabase functions deploy cosmos-gtin --project-ref yyegkdtbkbtpwyrnbfhk`.

O plano Basic informa limite de 25 consultas por dia. A função exige uma sessão autenticada do ValidaStock e valida o GTIN antes da consulta. Confira os dados sugeridos antes de salvar.

## Abrir

Sirva esta pasta por `localhost` ou HTTPS. Exemplo com PHP instalado: execute `php -S localhost:8000` dentro desta pasta e visite `http://localhost:8000`. Crie uma conta ou entre com uma conta já existente.

## Funcionalidades

- Login e cadastro via Supabase Auth.
- Produtos, lotes e movimentações sincronizados na nuvem.
- Painel de validade, busca e filtros.
- Entradas, saídas, ajustes de saída e descartes com justificativa.
- Entrada/baixa de estoque e histórico gravados na mesma transação.
- Isolamento dos dados por conta via políticas RLS.
- Interface responsiva para computador e celular.

## Escopo atual

A primeira conexão usa uma conta como proprietária dos dados. Ainda não há estrutura multiempresa/filiais e papéis de funcionário, conforme a evolução descrita no documento. O cadastro de produtos pode ler códigos de barras e QR pela câmera em navegadores compatíveis. Para códigos numéricos, o app consulta o catálogo público Open Food Facts e sugere nome/marca quando encontra o produto; revise os dados, pois a cobertura pode variar. O código lido é enviado ao catálogo para essa consulta. O preenchimento manual continua disponível. O acesso à câmera requer HTTPS ou localhost e autorização do usuário. Antes de operar, configure HTTPS, confirmação e recuperação de conta e backups do projeto Supabase.
