// Ecografia (TR 1.2.50): recepção e lista de trabalho da agenda de ultrassonografias, execução, laudo com
// modelos e imagens, assinatura gráfica a distância, impressão do resultado e do envelope, exames retirados,
// laudos no prontuário e relatórios. Telas do núcleo comum de diagnóstico por imagem (RadiologiaNucleo.tsx).
import { registrarTelasImagem } from './RadiologiaNucleo';

registrarTelasImagem({
  sigla: 'ECO',
  esquema: 'eco',
  rota: 'ecografia',
  titulo: 'Ecografia',
  exames: 'ultrassonografias',
  radiologica: false,
  palavras: ['ecografia', 'ultrassom', 'ultrassonografia', 'usg', 'ecografia obstétrica', 'laudo'],
});
