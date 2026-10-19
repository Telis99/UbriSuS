// Cargas iniciais e de demonstração dos módulos (registradas ao importar).
import './farmacia/carga.js';
import './imunizacao/carga.js';
import { importarDosModulos } from './descoberta.js';
await importarDosModulos('carga');
