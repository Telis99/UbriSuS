// Relatórios da Radiologia (TR 1.2.45.9.1 a 1.2.45.9.3) e de apoio à recepção e à entrega de resultados.
import { PERIODO, registrarRelatorio } from '../../servicos/catalogo.js';
import { registrarRelatoriosImagem } from './imagem-relatorios.js';
import { RAD } from './config.js';
import { consumoFilmes } from './servico.js';

registrarRelatoriosImagem(RAD, {
  analitico: { tr: ['1.2.45.9.1'] },
  sintetico: { tr: ['1.2.45.9.2'] },
  agendamentos: { tr: ['1.2.45.9.3'] },
  faltosos: { tr: ['1.2.45.8.14'] },
  naoRetirados: { tr: ['1.2.45.8.15'] },
  pendentes: { tr: ['1.2.45.8.4'] },
});

registrarRelatorio({
  id: 'rad-consumo-filmes',
  modulo: 'RAD',
  grupo: 'Produção',
  permissao: 'rad_atendimento:exportar',
  titulo: 'Consumo de filmes e contraste por equipamento',
  filtros: [...PERIODO, { nome: 'unidadeId', rotulo: 'Unidade do prestador', tipo: 'ref', ref: 'unidade' }],
  async gerar(f) {
    const linhas = await consumoFilmes(f.de, f.ate, f.unidadeId || null);
    return {
      linhas,
      agrupar: ['unidade'],
      grafico: { tipo: 'barra', x: 'tamanho', y: 'filmes' },
      colunas: [
        { campo: 'unidade', titulo: 'Unidade' },
        { campo: 'equipamento', titulo: 'Equipamento' },
        { campo: 'tamanho', titulo: 'Tamanho do filme' },
        { campo: 'exames', titulo: 'Exames', formato: 'inteiro', total: true },
        { campo: 'filmes', titulo: 'Filmes', formato: 'inteiro', total: true },
        { campo: 'perdidos', titulo: 'Perdidos/repetições', formato: 'inteiro', total: true },
        { campo: 'contrastados', titulo: 'Com contraste', formato: 'inteiro', total: true },
      ],
    };
  },
});
