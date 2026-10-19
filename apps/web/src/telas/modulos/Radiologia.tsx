// Radiologia (TR 1.2.45): recepção e lista de trabalho da agenda de radiografias, execução com incidências,
// filmes e contraste, laudo com modelos e imagens, assinatura gráfica, impressão do resultado e do envelope,
// entrega/exames não retirados, laudos no prontuário e relatórios. Telas do núcleo comum (RadiologiaNucleo.tsx).
import { registrarTelasImagem } from './RadiologiaNucleo';

registrarTelasImagem({
  sigla: 'RAD',
  esquema: 'rad',
  rota: 'radiologia',
  titulo: 'Radiologia',
  exames: 'radiografias',
  radiologica: true,
  palavras: ['radiologia', 'raio x', 'raios x', 'radiografia', 'mamografia', 'laudo'],
});
