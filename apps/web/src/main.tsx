// Interface em português do Brasil (textos, datas e calendários) com componentes que dão retorno visual imediato,
// diferenciam opções habilitadas/desabilitadas e organizam as telas em áreas delimitadas.
// TR 1.1.2.1.22, 1.1.2.1.24, 1.1.2.1.27, 1.1.2.1.28.
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './estilos.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { createTheme, MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import 'dayjs/locale/pt-br';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { ProvedorAuth } from '@/auth/Auth';
import { ProvedorDitado } from '@/voz/Ditado';
import { App } from './App';

dayjs.extend(customParseFormat);
dayjs.locale('pt-br');

const tema = createTheme({
  primaryColor: 'blue',
  fontFamily: 'Inter, "Segoe UI", Roboto, Arial, sans-serif',
  defaultRadius: 'sm',
  colors: {
    blue: ['#e8f1fb', '#d0e1f6', '#a3c3ec', '#72a3e2', '#4987d9', '#3075d4', '#1c5aa8', '#164c91', '#0f3d78', '#082c5a'],
  },
  primaryShade: 6,
  components: {
    TextInput: { defaultProps: { size: 'sm' } },
    Select: { defaultProps: { size: 'sm', allowDeselect: false } },
    Tooltip: { defaultProps: { openDelay: 300 } },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={tema}>
      <DatesProvider settings={{ locale: 'pt-br', firstDayOfWeek: 0 }}>
        <ModalsProvider labels={{ confirm: 'Confirmar', cancel: 'Cancelar' }}>
          <Notifications position="top-right" limit={4} />
          <BrowserRouter>
            <ProvedorAuth>
              <ProvedorDitado>
                <App />
              </ProvedorDitado>
            </ProvedorAuth>
          </BrowserRouter>
        </ModalsProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);
