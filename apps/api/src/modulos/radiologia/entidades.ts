// Radiologia (TR 1.2.45): exames prestados, estruturas/órgãos, modelos de resultado, assinantes, cabeçalhos,
// salas/equipamentos, exames dos pacientes (recepção, execução, laudo, entrega) e imagens digitalizadas.
// As definições são geradas pelo núcleo comum (imagem.ts), compartilhado com a Ecografia.
import { definirEntidadesImagem } from './imagem.js';
import { RAD } from './config.js';

definirEntidadesImagem(RAD);
