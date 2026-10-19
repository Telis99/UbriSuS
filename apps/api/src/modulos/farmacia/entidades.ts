// Farmácia e assistência farmacêutica (TR 1.2.20 a 1.2.30).
import { campoAtivo, campoNome, definirEntidade } from '../../meta/registro.js';

const FAR = 'FAR';

// Denominações Comuns Brasileiras - Anvisa (TR 1.2.20.1.13).
definirEntidade({
  nome: 'dcb',
  tabela: 'far.dcb',
  titulo: 'Denominações Comuns Brasileiras (DCB)',
  tituloSingular: 'DCB',
  modulo: FAR,
  menu: 'Farmácia/Tabelas',
  rotulo: ['numero', 'nome'],
  ordemPadrao: 'nome',
  tr: ['1.2.20.1.13', '1.2.20.1.14', '1.2.20.1.15'],
  campos: [
    { nome: 'numero', tipo: 'texto', rotulo: 'Nº DCB', max: 10, unico: true, lista: true, busca: true },
    campoNome(200, { rotulo: 'Substância' }),
    { nome: 'cas', tipo: 'texto', rotulo: 'Nº CAS', max: 20, lista: true },
    campoAtivo,
  ],
});
