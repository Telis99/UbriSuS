// Importa todas as telas para registrá-las no menu e no roteamento de janelas.
import './genericas';
import './admin';
import './Agendamento';
import './AgendaDia';
import './Recepcao';
import './Fila';
import './Atendimento';
import './Pacientes';
import './Relatorios';
import './Farmacia';
import './Imunizacao';
import './Faturamento';
// Telas dos módulos plugáveis (uma por arquivo em telas/modulos), registradas automaticamente.
import.meta.glob('./modulos/*.tsx', { eager: true });
