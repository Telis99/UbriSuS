// Rotas da Radiologia (TR 1.2.45): recepção e lista de trabalho da agenda de radiografias, execução com
// incidências/filmes/contraste, laudo com modelos, assinatura gráfica, impressão do resultado e do envelope
// com código de validação, entrega, faltosos, exames não retirados e integração com o prontuário.
import type { FastifyInstance } from 'fastify';
import './relatorios.js';
import { RAD } from './config.js';
import { registrarGanchosImagem, registrarRotasImagem } from './imagem-rotas.js';

registrarGanchosImagem(RAD);

export default async function rotasRadiologia(app: FastifyInstance) {
  await registrarRotasImagem(app, RAD);
}
