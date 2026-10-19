# Super agente local do UbriSUS

Esta pasta deixa o projeto pronto para continuar com **IA local**, sem enviar nada para a nuvem.
Usa quatro ferramentas:

- **Ollama**: roda o modelo de IA no seu computador.
- **Qwen 3.5 4B**: o modelo.
- **Open WebUI**: conversa e consulta aos documentos pelo navegador.
- **Continue**: assistente dentro do VS Code.

A **lei** do super agente é o **Edital PE 71/2025** e o **Termo de Referência (Anexo I)**, que
estão em `docs/edital/` em PDF e em texto. O agente consulta esses documentos antes de agir e não
pode contrariá-los (`prompts/lei.md`).

## Como funciona

```
você ──► SUPER AGENTE (ia-local/superagente.mjs)
            │  consulta a lei (Edital + TR + matriz de rastreabilidade)
            │  vê o que falta (pendencias)
            │  cria especialistas (criar_agente) e entrega tarefas (delegar)
            ▼
        AGENTES ESPECIALISTAS (ia-local/agentes/*.json)
            │  pesquisam na internet (buscar_internet, ler_pagina)
            │  registram o que aprenderam (ia-local/conhecimento/<agente>.md)
            │  leem e alteram o código (com sua aprovação)
            │  verificam (npm run typecheck, cobertura do TR)
            ▼
        relatório ──► super agente confere ──► resposta para você
```

- **Base de conhecimento:** edital, TR (os 2.661 itens com a situação de cada um), convenções do
  código e tudo o que os agentes aprenderam. A busca é local, por relevância, e o que um agente
  aprende passa a valer para todos.
- **Equipe inicial**, em `agentes/`:
  - `analista-requisitos`;
  - `jurista-licitacoes`;
  - `especialista-faturamento-sus`;
  - `especialista-esus-rnds`;
  - `especialista-farmacia`;
  - `especialista-urgencia-upa`;
  - `dev-backend`;
  - `dev-frontend`;
  - `seguranca-lgpd`;
  - `qa-poc`.

  O super agente cria outros especialistas quando precisar, e os especialistas também podem criar e
  delegar, até o nível definido em `profundidadeMaxima`.
- **Segurança:**
  - Toda gravação de arquivo e todo comando fora da lista segura (`comandosLivres` em
    `config.json`) **pedem sua aprovação** (s/n).
  - Os agentes não acessam nada fora da pasta do projeto.
- **Memória:** decisões e progresso ficam em `memoria/diario.md`, lido no início de cada tarefa.

## Instalação, uma vez só

1. **Ollama**: instale em https://ollama.com/download e baixe os modelos.

   ```
   ollama pull qwen3.5:4b
   ollama pull nomic-embed-text
   ollama create ubrisus-agente -f ia-local/Modelfile
   ```

   O `nomic-embed-text` é usado pelo Continue e pelo Open WebUI. O `ubrisus-agente` é o modelo com
   a lei embutida, usado no Continue e no Open WebUI.

2. **Projeto**: entre na pasta do projeto e atualize.

   ```
   cd %USERPROFILE%\Documents\UbriSuS
   git pull
   npm install
   ```

   No Mac/Linux, use `cd ~/Documents/UbriSuS`.

3. **Continue (VS Code)**:
   - Instale a extensão "Continue".
   - Abra a pasta `UbriSuS` no VS Code.
   - O arquivo `.continue/config.yaml` deste projeto já configura os modelos locais e as regras
     (`.continue/rules/`).
   - Se a extensão não carregar sozinha, copie o conteúdo de `.continue/config.yaml` para o
     `config.yaml` do Continue (ícone de engrenagem › "Open config").
   - Use o modo **Agent** com o modelo "UbriSUS Agente".

4. **Open WebUI**: com Docker, rode

   ```
   docker run -d -p 3000:8080 --add-host=host.docker.internal:host-gateway -v open-webui:/app/backend/data --name open-webui ghcr.io/open-webui/open-webui:main
   ```

   Depois, em http://localhost:3000, siga [open-webui.md](open-webui.md) para criar a base com os
   PDFs, o modelo "Super Agente UbriSUS" e a pesquisa na internet.

## Comando inicial

Com o Ollama aberto, na pasta do projeto:

```
npm run agente:verificar
npm run agente
```

- `npm run agente:verificar` confere o Ollama, o modelo e a base de conhecimento.
- `npm run agente` abre a conversa com o super agente.

Primeira tarefa sugerida:

```
Leia a lei, veja as pendências de cobertura e me apresente um plano por prioridade para chegar a 100% do TR e passar na prova de conceito (mínimo 90%). Ainda não altere nada.
```

Outros usos:

```
npm run agente -- "Implemente o item 1.2.42.2.24 (alerta de preventivo em atraso) e verifique"
npm run agente -- --agente especialista-faturamento-sus "Confira o leiaute do BPA contra a fonte oficial"
npm run agente -- --auto "..."
```

O `--auto` aprova gravações automaticamente. Use apenas com o projeto commitado no git.

Dentro da conversa:
- `/agentes` lista a equipe;
- `/limpar` zera a conversa;
- `sair` encerra.

## Ajustes (`config.json`)

| Chave | Para quê |
|---|---|
| `modelo` / `modeloAgentes` | Modelo do super agente e dos especialistas, como aparece em `ollama list` (ex.: `qwen3.5:4b`, `qwen3.5:9b`). |
| `contexto` | Janela de contexto em tokens. Com 8 GB de RAM use 8192; com 16 GB ou mais, 16384 a 32768. |
| `pensar` | `true` liga o raciocínio do Qwen 3.5: melhor qualidade, mais lento. |
| `maxPassos` | Máximo de ações por agente em cada tarefa. |
| `profundidadeMaxima` | Até onde especialistas podem criar e delegar a outros especialistas. |
| `searxngUrl` | Endereço de um SearXNG próprio (ex.: `http://localhost:8888`) para pesquisas melhores. Vazio = DuckDuckGo. |
| `comandosLivres` | Comandos que rodam sem pedir aprovação (somente leitura e verificação). |

## Dicas para modelo pequeno (4B)

- Peça **uma coisa por vez**: uma seção ou um item do TR. Tarefas enormes confundem modelos
  pequenos.
- Sempre exija que ele verifique: `npm run typecheck` e `npm run requisitos:cobertura`.
- Revise as alterações com `git diff` antes de commitar. Faça commits pequenos e frequentes.
- Se a qualidade não bastar, troque `modeloAgentes` por um modelo maior (ex.: `qwen3.5:9b`) no
  `config.json`, mantendo o 4B para o super agente.

## Problemas comuns

| Mensagem | Causa e solução |
|---|---|
| `dial tcp 127.0.0.1:11434 ... recusou` | O **servidor do Ollama não está rodando**. Abra o aplicativo "Ollama" pelo menu Iniciar (ele fica no ícone da bandeja, perto do relógio) ou, em outro terminal, rode `ollama serve` e deixe a janela aberta. Teste com `ollama list`. |
| `Modelo "qwen3.5:4b" não está instalado` | Rode `ollama pull qwen3.5:4b` e confira o nome com `ollama list`. |
| `npm` não é reconhecido | Instale o Node.js 22 (https://nodejs.org) e abra um novo terminal. |
| Pasta `ia-local` não existe | O projeto foi baixado antes da criação do super agente: rode `git pull` na pasta do projeto. |
