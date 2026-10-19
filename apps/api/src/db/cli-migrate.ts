import { migrar } from './migrar.js';

migrar()
  .then(() => {
    console.log('Banco de dados atualizado.');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
