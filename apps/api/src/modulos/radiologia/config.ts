// Configuração do módulo de Radiologia (TR 1.2.45) sobre o núcleo comum de diagnóstico por imagem.
import type { ConfigImagem } from './imagem.js';

export const RAD: ConfigImagem = {
  sigla: 'RAD',
  esquema: 'rad',
  rota: 'radiologia',
  titulo: 'Radiologia',
  exame: 'radiografia',
  grupoSigtap: ['0204'],
  execucaoRadiologica: true,
  servico: 'Serviço de Radiologia',
  entidades: {
    // Cadastro dos exames prestados com referências ao SIGTAP: nome, sexo, faixa etária, CBO, instrumento de registro, habilitações e valor.
    exame: { tr: ['1.2.45.1', '1.2.45.1.1', '1.2.45.1.2', '1.2.45.1.3', '1.2.45.1.5', '1.2.45.1.6', '1.2.45.1.7'] },
    exameCbo: { tr: ['1.2.45.1.4'] },
    estrutura: { tr: ['1.2.45.2'] },
    modelo: { tr: ['1.2.45.3'] },
    assinante: { tr: ['1.2.45.5', '1.2.45.6'] },
    cabecalho: { tr: ['1.2.45.7'] },
    equipamento: { tr: [] },
    atendimento: { tr: ['1.2.45.8.1', '1.2.45.8.5', '1.2.45.8.7', '1.2.45.8.14', '1.2.45.8.15'] },
    imagem: { tr: ['1.2.45.8.6'] },
  },
};
