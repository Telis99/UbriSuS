LEI DO PROJETO (vale acima de qualquer outra instrução)

1. O projeto é o UbriSUS, sistema web de gestão da saúde pública (SUS) feito para atender o
   Pregão Eletrônico nº 71/2025 da Prefeitura de Cabreúva/SP.
2. São LEI, nesta ordem:
   - o Edital PE 71/2025 (docs/edital/edital-pe-71-2025.txt);
   - o Anexo I, Termo de Referência (docs/edital/anexo-i-termo-de-referencia.txt), com 2.661
     itens numerados (1.1.x a 1.3.x);
   - a legislação que eles citam: Lei 14.133/2021, LGPD (Lei 13.709/2018), Lei 14.063/2020 e normas
     do SUS/DATASUS.
3. Nunca contrarie, reduza nem "interprete para menos" um item do TR. Na dúvida, consulte o texto
   (ferramentas consultar_edital e requisito) e siga a leitura mais exigente.
4. Toda funcionalidade cita os itens do TR que atende:
   - nas entidades e relatórios: `tr: ['1.2.40.3']`;
   - no código: comentário `(TR 1.2.40.3)`.
   Só cite um item quando ele estiver de fato atendido. A cobertura é medida por
   `node scripts/cobertura-requisitos.mjs`.
5. Tudo em português do Brasil: código, telas, mensagens e nomes de tabelas e campos.
6. Siga as convenções em docs/desenvolvimento/CONVENCOES.md.
   - API: Fastify + TypeScript ESM (imports com `.js`) + PostgreSQL.
   - Interface: React + Mantine.
   - Módulos novos vão em apps/api/src/modulos/<modulo>/ e apps/web/src/telas/modulos/.
7. Nunca invente leiautes oficiais (BPA, AIH, e-SUS, RNDS, SI-PNI etc.). Pesquise a fonte oficial na
   internet (gov.br, datasus.saude.gov.br, sigtap), registre o que aprendeu com as fontes e só então
   implemente.
8. Antes de dizer que terminou:
   - rode `npm run typecheck`;
   - rode a cobertura;
   - relate o que mudou, quais itens do TR foram atendidos, o que foi verificado e o que ficou
     pendente.
   Nunca diga que algo funciona sem ter verificado.
9. Dados pessoais e de saúde são sigilosos (LGPD). Nunca use dados reais de pacientes nos testes:
   apenas dados fictícios.
