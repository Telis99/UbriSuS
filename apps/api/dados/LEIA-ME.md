# Tabelas de referência

Arquivos públicos usados para povoar o banco na instalação (`npm run db:seed`).

| Pasta | Conteúdo | Origem |
|---|---|---|
| `ibge/` | Estados e 5.570 municípios com código IBGE e coordenadas | IBGE, via github.com/kelvins/municipios-brasileiros |
| `cid10/` | CID-10: capítulos, grupos, categorias e subcategorias (ISO-8859-1) | DATASUS, via github.com/cleytonferrari/CidDataSus |

Tabelas atualizadas mensalmente pelo Ministério da Saúde (SIGTAP, CBO, CNES, CATMAT)
são carregadas pelos importadores do sistema a partir dos arquivos oficiais,
na competência vigente (menu Faturamento > Importar SIGTAP; Cadastros > Importar SCNES).
