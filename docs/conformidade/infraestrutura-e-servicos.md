# Infraestrutura, hospedagem, serviços e conformidade legal

Itens do Termo de Referência (Anexo I do Pregão Eletrônico nº 71/2025) que **não são
funcionalidades do software**: dizem respeito ao ambiente de hospedagem, aos níveis de serviço, ao
suporte, à capacitação e às obrigações contratuais da contratada. Para cada grupo, registra-se o
**compromisso da contratada** (a ser comprovado na proposta, na auditoria do data center e na
execução do contrato) e **como o sistema dá suporte** a ele.

Na matriz de rastreabilidade estes itens aparecem como *ATENDIDO (infraestrutura/serviço,
documentado)*, separados dos itens implementados no código.

> Antes da proposta, a licitante deve preencher os campos marcados com ☐: provedor de data center,
> certificações, contatos de suporte e responsáveis técnicos.

---

## 1. Hospedagem em nuvem e data center

**Itens:** TR 1.1.1.24, 1.1.1.24.1, 1.1.1.24.2, 1.1.1.24.2.1, 1.1.1.24.2.1.1 a 1.1.1.24.2.1.8,
1.1.1.67, 1.1.1.68, 1.1.1.69, 1.1.1.69.1, 1.1.2.1.7, 1.1.2.1.7.1, 1.1.2.1.7.2.

**Compromisso da contratada**
- O sistema fica hospedado em data center no Brasil, próprio ou terceirizado, com uma de duas
  comprovações:
  - certificação **TIER II** (ou equivalente declaratória) e disponibilidade mínima de **99,7%**;
  - conformidade com a **NBR ISO/IEC 27001:2013**.
- Provedor: ☐ __________. Certificações apresentadas: ☐ __________.
- A municipalidade pode auditar o data center presencialmente, antes da assinatura do contrato. A
  contratada disponibiliza para essa auditoria, com teste:
  - redundância de servidor hospedeiro, energia elétrica e link;
  - refrigeração;
  - controle e monitoramento de acesso;
  - monitoramento de hardware;
  - supressão de incêndio;
  - documentação técnica do projeto.
- A contratante tem acesso ao painel (*dashboard*) de monitoramento do data center: ☐ endereço e
  credencial entregues na implantação.

**Como o sistema dá suporte**
- A API não guarda estado de sessão em memória (as sessões ficam no banco). Por isso pode rodar em
  várias instâncias atrás de balanceador, com failover entre servidores hospedeiros.
- PostgreSQL 16 com replicação em espera (*streaming replication*).
- O PostgreSQL também envia o log de transações (WAL) continuamente para outro local, o que
  permite recuperação de desastre (*disaster recovery*).
- Cópias diárias validadas pela própria aplicação (Administração › Banco de dados › Cópias de
  segurança).

## 2. Recursos computacionais mínimos e escalabilidade

**Itens:** TR 1.1.1.27, 1.1.1.27.1 a 1.1.1.27.3, 1.1.1.28, 1.1.1.28.1 a 1.1.1.28.6.

**Compromisso da contratada:** disponibilizar, no mínimo, os recursos abaixo, e ampliá-los sob
demanda (link em MB, disco em GB e memória RAM em GB adicionais).

| Recurso | Mínimo | Uso no sistema |
|---|---|---|
| Link dedicado | 5 Mbps | API trafega somente JSON compactado; interface servida em arquivos estáticos com cache |
| vCPU | 6 | Instâncias da API (Node.js) + PostgreSQL |
| Memória RAM | 8 GB | Pool de conexões, cache de sessões |
| Disco do banco de dados | 300 GB | PostgreSQL (dados e índices) |
| Disco de cópias de segurança | 800 GB | Diretório de `pg_dump` (cópias diárias com retenção configurável) |
| Disco do repositório de arquivos | 250 GB | Imagens e documentos (anexos, laudos, fotos) |

## 3. Comunicação e segurança perimetral

**Itens:** TR 1.1.1.13, 1.1.1.25, 1.1.1.25.1, 1.1.1.25.2, 1.1.1.25.3, 1.1.2.1.5, 1.1.2.1.33.

**Compromisso da contratada**
- Roteamento dinâmico **eBGP** com, no mínimo, duas operadoras distintas.
- **WAF/IPS** que bloqueia SQL Injection em todas as variantes e ataques de negação de serviço
  (DoS/DDoS).
- Firewall que bloqueia endereços e portas não utilizados. Ficam expostas somente as portas 443 e
  80, esta última apenas redirecionando para HTTPS.
- Certificado **SSL/TLS** válido, emitido por autoridade certificadora reconhecida pelos
  navegadores (Firefox 70+, Chrome 70+, Edge 80+, Safari 13+). A aquisição é feita pela
  contratada.

**Como o sistema dá suporte**
- Validação no navegador: obrigatoriedade, máscaras e tamanho máximo dos campos.
- O servidor revalida tudo com os esquemas `zod`.
- Todas as consultas ao banco usam parâmetros (sem concatenação de SQL). O gerador de relatórios
  roda somente leitura e com tempo limite.
- Cabeçalhos de segurança (`helmet`: CSP, HSTS, X-Frame-Options), cookie de sessão `HttpOnly` e
  `SameSite=Strict`, proteção CSRF e limite de requisições no login.

## 4. Acesso ao banco de dados e sigilo das informações

**Itens:** TR 1.1.1.22, 1.1.1.71, 1.1.1.71.1.

**Compromisso da contratada**
- Nenhum operador da contratante ou terceiro acessa o SGBD diretamente durante o contrato.
- Integrações por cópia direta ou backup somente com anuência expressa da contratada.
- Os dados são tratados como sigilosos e usados apenas para as finalidades da Secretaria de Saúde.
- Compartilhamento somente em casos de interesse público, com autorização expressa do controlador
  (Município) e conforme a LGPD (Lei 13.709/2018).

**Como o sistema dá suporte**
- A aplicação usa um papel de banco sem privilégio de DBA (`DATABASE_URL`); as atualizações usam um
  papel separado (`DATABASE_URL_MIGRADOR`).
- Toda alteração de dados é auditada, com antes/depois, operador e IP.
- Dados sigilosos e certificados são cifrados com AES-256-GCM.
- O sistema tem perfil de encarregado de dados (LGPD) e registra os aceites de termos.
- O pacote de portabilidade exclui credenciais e segredos.
- O acesso ao gerador de consultas exclui as tabelas de segurança.

## 5. Atualização dos sistemas estruturantes

**Item:** TR 1.1.1.72.

**Compromisso da contratada**
- Manter atualizados o sistema operacional, o Node.js (versão LTS), o PostgreSQL (versão suportada)
  e as bibliotecas.
- Correções de segurança críticas são aplicadas em até 72 horas da publicação pelo fabricante ou
  pela comunidade.
- Monitoramento contínuo de vulnerabilidades das dependências (`npm audit`) e das imagens.
- Atualizações aplicadas em janela combinada, com cópia de segurança validada antes.

## 6. Suporte técnico, níveis de serviço (SLA) e parceiros

**Itens:** TR 1.1.1.26, 1.1.1.26.1, 1.1.1.73.1, 1.1.1.73.1.1, 1.1.1.73.2, 1.1.1.73.2.1,
1.1.1.73.3, 1.1.1.73.3.1, 1.1.1.73.4, 1.1.1.73.4.1, 1.1.1.80, 1.1.1.80.1.

**Compromisso da contratada:** suporte técnico **8x5**, por telefone ☐ (__) ____-____ e pela
plataforma de chamados integrada ao sistema (menu Suporte).

| Atendimento | Prazo máximo | Multa por descumprimento (sobre a fatura mensal) |
|---|---|---|
| Suporte por telefone (orientações técnicas/operacionais) | 1 hora | 0,5% |
| Atendimento de chamado na plataforma | 2 horas | 1% |
| Correção de inconsistência de dados ou falha que compromete um módulo | 8 horas | 2,5% |
| Reparo de funcionalidade isolada (sem comprometer o módulo) | 24 horas | 1% |

O suporte executado por parceiros ou fabricantes consorciados é de inteira responsabilidade da
contratada e segue os mesmos prazos.

**Como o sistema dá suporte:** os chamados abertos no sistema registram data e hora de abertura,
atendimento e conclusão. Isso permite apurar o cumprimento dos prazos.

## 7. Horas de serviços especializados

**Itens:** TR 1.1.1.81, 1.1.1.81.1, 1.1.1.81.1.1, 1.1.1.81.2, 1.1.1.81.2.1, 1.1.1.81.3,
1.1.1.81.3.1, 1.1.1.81.4, 1.1.1.81.4.1, 1.1.1.81.5, 1.1.1.81.5.1.

| Serviço | Horas disponíveis |
|---|---:|
| Treinamento de operadores pós-implantação | 140 |
| Consultoria para execução pontual de rotinas (ex.: verificação de integridade do banco de dados) | 50 |
| Configuração personalizada de ambiente pós-implantação | 60 |
| Customização de ferramentas e funcionalidades | 50 |
| Mapeamento de processos | 60 |

Para a verificação de integridade, o sistema já oferece a validação das cópias de segurança
(SHA-256 e leitura do catálogo) e a verificação de consistência dos cadastros.

## 8. Integrações com sistemas externos

**Item:** TR 1.1.1.43.

**Compromisso da contratada:** quando uma integração não for possível, a contratada apresenta
justificativa técnica por escrito. A justificativa deve ligar a impossibilidade à incapacidade do
sistema externo de aceitar a integração: falta de API, de leiaute publicado ou de credencial.

Integrações disponíveis no sistema:
- BPA magnético (SIA);
- AIH (SISAIH01);
- APAC e RAAS;
- e-SUS AB (LEDI/CDS);
- SI-PNI/RNDS (FHIR);
- CADSUS/RNDS;
- interfaceamento de equipamentos laboratoriais;
- assistência farmacêutica;
- gateways de SMS e e-mail;
- Login Único gov.br.

## 9. Legislação, normas do SUS e customização

**Itens:** TR 1.1.1.1, 1.1.1.1.1, 1.1.2.1.3, 1.1.2.1.4, 1.1.2.1.61.

**Compromisso da contratada**
- Manter o sistema aderente à legislação federal e do Estado de São Paulo e às normas dos órgãos de
  controle, incluindo:
  - tabela SIGTAP e leiautes do DATASUS;
  - Portaria SVS/MS 344/1998 (controlados);
  - Lei 13.709/2018 (LGPD);
  - Lei 14.063/2020 (assinaturas eletrônicas);
  - resoluções do CFM sobre prontuário eletrônico;
  - calendário nacional de vacinação.
- Normas específicas do Município de Cabreúva são parametrizadas na implantação, em prazos
  combinados.
- Melhorias solicitadas pela contratante são atendidas quando tecnicamente viáveis. Quando não
  forem, a contratada apresenta justificativa.

**Como o sistema dá suporte**
- Parâmetros por módulo.
- Cadastros por metadados.
- Gerador de relatórios e consultas.
- Formatos de impressão configuráveis.
- Importação das tabelas oficiais (SIGTAP, CID-10, CBO, IBGE).

## 10. Formulários das unidades de saúde

**Itens:** TR 1.1.2.1.62, 1.1.2.1.62.1.

Disponíveis no sistema (impressos em PDF com código de validação):
- ficha de atendimento ambulatorial (em branco, preenchida e com procedimento pré-definido);
- receituário comum e de controle especial;
- atestados e declarações;
- requisição de exames;
- encaminhamento e contrarreferência;
- comprovantes de agendamento e de dispensação;
- cartão e carteira de vacinação;
- ficha de atendimento odontológico (FAO);
- laudo e pedido de TFD;
- laudo de AIH e APAC;
- fichas de notificação de agravos;
- laudos de laboratório, radiologia e ecografia;
- ordem de tráfego e lista de passageiros do transporte.

**Compromisso da contratada:** criar no sistema, até o término da capacitação, os formulários
usados pelas unidades do Município que ainda não estejam disponíveis em meio digital.
