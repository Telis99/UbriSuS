# Open WebUI: conversa e consulta à lei do projeto

O Open WebUI serve para **conversar e consultar** o Edital e o Termo de Referência pelo navegador.
O trabalho com vários agentes alterando o código é feito pelo super agente no terminal
(`npm run agente`) ou pelo Continue no VS Code.

## 1. Conectar ao Ollama

Abra http://localhost:3000 e crie o usuário administrador. Em **Configurações do administrador ›
Conexões**, confirme que a conexão Ollama aponta para `http://host.docker.internal:11434`. Os
modelos `qwen3.5:4b` e `ubrisus-agente` devem aparecer na lista.

## 2. Base de conhecimento com a lei

1. Abra **Workspace › Conhecimento › +** e crie a base **"Lei do projeto UbriSUS"**.
2. Envie os arquivos do projeto:
   - `docs/edital/edital-pe-71-2025.pdf` (Edital);
   - `docs/edital/anexo-i-termo-de-referencia.pdf` (Termo de Referência);
   - `docs/requisitos/matriz-rastreabilidade.md` (situação de cada item);
   - `docs/conformidade/infraestrutura-e-servicos.md`;
   - `docs/desenvolvimento/CONVENCOES.md`.
3. Opcional: em **Configurações do administrador › Documentos**, escolha o modelo de embeddings
   `nomic-embed-text` (via Ollama). Ele melhora a busca em português.

## 3. Modelo "Super Agente UbriSUS"

1. Abra **Workspace › Modelos › +** e preencha:
   - **Nome:** Super Agente UbriSUS.
   - **Modelo base:** `ubrisus-agente`, ou `qwen3.5:4b`.
   - **Prompt de sistema:** cole o conteúdo de `ia-local/prompts/lei.md` seguido do de
     `ia-local/prompts/superagente.md`.
   - **Conhecimento:** selecione "Lei do projeto UbriSUS".
   - **Capacidades:** marque Pesquisa na web, se configurada no item 4.
2. Salve. Nas conversas, escolha "Super Agente UbriSUS".

Para criar especialistas no Open WebUI:
- repita o passo 1 para cada arquivo de `ia-local/agentes/*.json`;
- use como prompt de sistema o conteúdo de `ia-local/prompts/especialista.md`, trocando
  `{nome}`, `{especialidade}`, `{missao}` e `{itens_tr}` pelos valores do JSON.

## 4. Pesquisa na internet

1. Em **Configurações do administrador › Pesquisa na Web**, ative a pesquisa e escolha o
   mecanismo:
   - **DuckDuckGo**: não precisa de chave;
   - **SearXNG**: o melhor. Para rodá-lo localmente:
     `docker run -d -p 8888:8080 --name searxng searxng/searxng`, e informe
     `http://host.docker.internal:8888/search?q=<query>`.
2. Se usar SearXNG, configure também `"searxngUrl": "http://localhost:8888"` em
   `ia-local/config.json`, para o super agente do terminal usar o mesmo buscador.
   - Habilite o formato JSON no `settings.yml` do SearXNG, em `search.formats`: html e json.
