// Configuração do módulo de Ecografia (TR 1.2.50) sobre o núcleo comum de diagnóstico por imagem (../radiologia/imagem.ts).
import type { ConfigImagem } from '../radiologia/imagem.js';

export const ECO: ConfigImagem = {
  sigla: 'ECO',
  esquema: 'eco',
  rota: 'ecografia',
  titulo: 'Ecografia',
  exame: 'ultrassonografia',
  grupoSigtap: ['0205'],
  execucaoRadiologica: false,
  servico: 'Serviço de Ultrassonografia',
  entidades: {
    // Cadastro dos exames prestados com referências ao SIGTAP: nome, sexo, faixa etária, CBO, instrumento de registro, habilitações e valor.
    exame: { tr: ['1.2.50.1', '1.2.50.1.1', '1.2.50.1.2', '1.2.50.1.3', '1.2.50.1.5', '1.2.50.1.6', '1.2.50.1.7'] },
    exameCbo: { tr: ['1.2.50.1.4'] },
    estrutura: { tr: ['1.2.50.2'] },
    modelo: { tr: ['1.2.50.3'] },
    assinante: { tr: ['1.2.50.5', '1.2.50.6'] },
    cabecalho: { tr: ['1.2.50.7'] },
    equipamento: { tr: [] },
    atendimento: { tr: ['1.2.50.8.1', '1.2.50.8.5', '1.2.50.8.7', '1.2.50.8.14'] },
    imagem: { tr: ['1.2.50.8.6'] },
  },
};
