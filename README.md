# UbriSUS — Sistema de Gestão da Saúde Pública

Sistema web de gestão da saúde para municípios (SUS), desenvolvido tendo como referência o
**Pregão Eletrônico nº 71/2025 da Prefeitura de Cabreúva/SP** (edital e Termo de Referência em
`docs/edital/`). Atende a rede municipal de saúde: agendamento e cadastros nacionais, ambulatório,
prontuário eletrônico, UPA, farmácia, imunização, faturamento (BPA/AIH/APAC/RAAS), laboratório,
radiologia, ecografia, odontologia, TFD, transporte sanitário, regulação, saúde mental (CAPS),
e-SUS AB, portal/aplicativo do cidadão, aplicativo do ACS, indicadores de gestão e administração.

A rastreabilidade de cada item do Termo de Referência está em
`docs/requisitos/matriz-rastreabilidade.md` (gerada por `npm run requisitos:cobertura`).

## Requisitos para rodar no computador

- **Node.js 22** ou superior — https://nodejs.org
- **PostgreSQL 16** — instalado no computador ou via Docker (`docker compose up -d`, arquivo `docker-compose.yml`)
- **Git** — https://git-scm.com
- Opcional: utilitários `pg_dump`/`pg_restore` no PATH (cópias de segurança pela tela de administração)

## Instalação

```bash
# 1. Baixar o projeto (ex.: na pasta Documentos)
cd ~/Documents                     # Windows: cd %USERPROFILE%\Documents
git clone -b claude/sistema-gestao-saude https://github.com/Telis99/UbriSuS.git
cd UbriSuS

# 2. Dependências
npm install

# 3. Banco de dados (se não tiver PostgreSQL instalado, use o Docker)
docker compose up -d

# 4. Configuração: copie o modelo e ajuste se necessário
cp .env.example .env               # Windows: copy .env.example .env

# 5. Estrutura do banco + tabelas de apoio + dados fictícios de demonstração
npm run setup

# 6. Subir a API (porta 3333) e a interface (porta 5173)
npm run dev
```

Abra **http://localhost:5173** no navegador.

Sem Docker, crie o banco antes do passo 5: `createdb -U postgres ubrisus` (ou pelo pgAdmin) e
ajuste `DATABASE_URL` no `.env` com o usuário e a senha do seu PostgreSQL.

## Usuários de demonstração

| Login | Senha | Perfil |
|---|---|---|
| `admin` | valor de `ADMIN_SENHA_INICIAL` no `.env` (padrão `Admin@2026forte`) | Administrador |
| `medico`, `enfermeira`, `recepcao`, `farmaceutica`, `dentista`, `acs`, `psicologa`, `gestor`, `radiologista`, `tecradiologia`, `ginecologista` | `Saude@2026` | Perfis operacionais |

Portal do cidadão: **http://localhost:5173/cidadao** · Aplicativo do ACS: **http://localhost:5173/acs**.
Todos os dados de demonstração são fictícios.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | API e interface em modo desenvolvimento (recarregam ao editar) |
| `npm run db:migrate` | Cria/atualiza o esquema do banco (sem apagar dados) |
| `npm run db:demo` | Carga inicial e dados de demonstração (idempotente) |
| `npm run setup` | `db:migrate` + `db:demo` |
| `npm run typecheck` | Verificação de tipos da API e da interface |
| `npm run build` | Build de produção (`apps/api/dist` e `apps/web/dist`) |
| `npm run requisitos:cobertura` | Recalcula a matriz de rastreabilidade do Termo de Referência |

Para recomeçar do zero: apague e recrie o banco `ubrisus` e rode `npm run setup` novamente.

## Produção

`npm run build` e `NODE_ENV=production node apps/api/dist/server.js` — a API serve também a
interface compilada (`WEB_DIST`). Defina obrigatoriamente `COOKIE_SECRET`, `CHAVE_CRIPTOGRAFIA`
(dados sigilosos e certificados são cifrados com ela — guarde-a com segurança), `DATABASE_URL`
com papel sem privilégio de DBA e `DATABASE_URL_MIGRADOR` para as atualizações. Use HTTPS
(proxy reverso com certificado válido). E-mail (`SMTP_*`) e SMS (`SMS_*`) são opcionais; sem
eles as mensagens ficam registradas no gerenciador e no log.

## Estrutura

```
apps/api/        API Fastify + TypeScript + PostgreSQL
  src/meta/        cadastros por metadados (tabelas, API CRUD, telas e menus gerados)
  src/modulos/     um diretório por módulo (entidades, regras, rotas, relatórios, carga)
  src/servicos/    relatórios/PDF, exportações, assinatura digital, mensageria, arquivos
  migrations/      SQL base (auditoria, segurança, papéis do banco)
apps/web/        Interface React + Mantine (navegador; PWA do cidadão e do ACS)
docs/edital/     Edital e Termo de Referência
docs/requisitos/ Itens do TR e matriz de rastreabilidade
docs/desenvolvimento/CONVENCOES.md   guia para criar e estender módulos
```

## Continuar o projeto com IA local

A pasta `ia-local/` traz um **super agente** que roda com Ollama + Qwen 3.5 4B e tem o Edital e o
Termo de Referência como lei. Ele cria e coordena agentes especialistas, que pesquisam na
internet quando precisam. Também vêm as configurações do Continue (`.continue/`) e do Open WebUI.
Veja `ia-local/README.md`. Comando inicial: `npm run agente`.
