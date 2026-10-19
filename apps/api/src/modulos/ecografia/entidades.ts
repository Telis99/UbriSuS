// Ecografia (TR 1.2.50): exames de ultrassonografia prestados, estruturas/órgãos, modelos de resultado,
// assinantes com assinatura gráfica, cabeçalhos, salas/equipamentos, exames dos pacientes e imagens.
// As definições são geradas pelo núcleo comum compartilhado com a Radiologia.
import { definirEntidadesImagem } from '../radiologia/imagem.js';
import { ECO } from './config.js';

definirEntidadesImagem(ECO);
