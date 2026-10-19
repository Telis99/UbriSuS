import { criarApp } from './app.js';
import { config } from './config.js';
import { iniciarProcessamentoFila } from './servicos/mensageria.js';
import { iniciarTarefasAgendadas } from './modulos/rotas.js';

const app = await criarApp();
await app.listen({ port: config.porta, host: config.host });
iniciarProcessamentoFila();
iniciarTarefasAgendadas();
console.log(`UbriSUS API em http://${config.host}:${config.porta}`);
