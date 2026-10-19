// Rotas da Ecografia (TR 1.2.50): recepção e lista de trabalho da agenda de ultrassonografias, execução, laudo
// com modelos, assinatura gráfica a distância, impressão do resultado e do envelope com código de validação,
// definição dos exames retirados e integração com o prontuário do paciente.
import type { FastifyInstance } from 'fastify';
import './relatorios.js';
import { registrarGanchosImagem, registrarRotasImagem } from '../radiologia/imagem-rotas.js';
import { ECO } from './config.js';

registrarGanchosImagem(ECO);

export default async function rotasEcografia(app: FastifyInstance) {
  await registrarRotasImagem(app, ECO);
}
