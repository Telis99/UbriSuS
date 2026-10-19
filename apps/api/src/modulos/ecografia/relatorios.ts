// Relatórios da Ecografia (TR 1.2.50.9.1 a 1.2.50.9.3) e de apoio à recepção e à entrega de resultados.
import { PERIODO, registrarRelatorio } from '../../servicos/catalogo.js';
import { registrarRelatoriosImagem } from '../radiologia/imagem-relatorios.js';
import { ECO } from './config.js';
import { statusLaudos } from './servico.js';

registrarRelatoriosImagem(ECO, {
  analitico: { tr: ['1.2.50.9.1'] },
  sintetico: { tr: ['1.2.50.9.2'] },
  agendamentos: { tr: ['1.2.50.9.3'] },
  faltosos: { tr: [] },
  naoRetirados: { tr: ['1.2.50.8.14'] },
  pendentes: { tr: ['1.2.50.8.4'] },
});

registrarRelatorio({
  id: 'eco-status-laudo-exame',
  modulo: 'ECO',
  grupo: 'Laudos',
  permissao: 'eco_atendimento:exportar',
  titulo: 'Status dos laudos por exame (não digitado, digitado, impresso)',
  tr: ['1.2.50.8.4'],
  filtros: [...PERIODO, { nome: 'unidadeId', rotulo: 'Unidade do prestador', tipo: 'ref', ref: 'unidade' }],
  async gerar(f) {
    const linhas = await statusLaudos(f.de, f.ate, f.unidadeId || null);
    return {
      linhas,
      agrupar: ['unidade'],
      colunas: [
        { campo: 'unidade', titulo: 'Unidade' },
        { campo: 'exame', titulo: 'Exame' },
        { campo: 'nao_digitados', titulo: 'Não digitados', formato: 'inteiro', total: true },
        { campo: 'digitados', titulo: 'Digitados', formato: 'inteiro', total: true },
        { campo: 'liberados', titulo: 'Assinados/anexados', formato: 'inteiro', total: true },
        { campo: 'impressos', titulo: 'Impressos', formato: 'inteiro', total: true },
      ],
    };
  },
});
