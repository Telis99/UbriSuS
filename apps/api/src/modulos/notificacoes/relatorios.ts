// Relatórios do gerenciador de notificações (TR 1.2.2.11).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio } from '../../servicos/catalogo.js';

const MEIO: [string, string][] = [
  ['sms', 'SMS'],
  ['email', 'E-mail'],
  ['push', 'Aplicativo'],
];

registrarRelatorio({
  id: 'msg-por-situacao',
  modulo: 'AGE',
  grupo: 'Notificações',
  titulo: 'Notificações enviadas por evento e situação',
  tr: ['1.2.2.11', '1.2.2.11.1', '1.2.2.11.7'],
  permissao: 'mensagem_paciente:consultar',
  filtros: [...PERIODO, { nome: 'meio', rotulo: 'Meio', tipo: 'opcao', opcoes: MEIO }],
  async gerar(f) {
    const linhas = await consultar(
      `select coalesce(m.evento, 'avulsa') evento, case m.meio when 'sms' then 'SMS' when 'email' then 'E-mail' else 'Aplicativo' end meio,
              count(*)::int total, count(*) filter (where m.situacao in ('enviada', 'recebida'))::int enviadas,
              count(*) filter (where m.situacao = 'recebida')::int recebidas, count(*) filter (where m.situacao = 'falha')::int falhas,
              count(*) filter (where m.situacao in ('agendada', 'aguardando'))::int pendentes, count(*) filter (where m.situacao = 'cancelada')::int canceladas
         from sis.mensagem m where m.gerada_em::date between $1 and $2 and ($3::text is null or m.meio = $3) group by 1, 2 order by 1, 2`,
      [f.de, f.ate, f.meio ?? null],
    );
    return {
      linhas,
      agrupar: ['evento'],
      grafico: { tipo: 'barra', x: 'evento', y: 'total' },
      colunas: [
        { campo: 'evento', titulo: 'Evento' },
        { campo: 'meio', titulo: 'Meio' },
        { campo: 'total', titulo: 'Geradas', formato: 'inteiro', total: true },
        { campo: 'enviadas', titulo: 'Enviadas', formato: 'inteiro', total: true },
        { campo: 'recebidas', titulo: 'Recebidas', formato: 'inteiro', total: true },
        { campo: 'falhas', titulo: 'Falhas', formato: 'inteiro', total: true },
        { campo: 'pendentes', titulo: 'Pendentes', formato: 'inteiro', total: true },
        { campo: 'canceladas', titulo: 'Canceladas', formato: 'inteiro', total: true },
      ],
    };
  },
});

registrarRelatorio({
  id: 'msg-detalhado',
  modulo: 'AGE',
  grupo: 'Notificações',
  titulo: 'Notificações aos pacientes (detalhado)',
  tr: ['1.2.2.11.2', '1.2.2.11.3', '1.2.2.11.4', '1.2.2.11.5', '1.2.2.11.6', '1.2.2.11.8'],
  permissao: 'mensagem_paciente:consultar',
  filtros: [
    ...PERIODO,
    { nome: 'meio', rotulo: 'Meio', tipo: 'opcao', opcoes: MEIO },
    {
      nome: 'situacao',
      rotulo: 'Situação',
      tipo: 'opcao',
      opcoes: [['agendada', 'Agendada'], ['aguardando', 'Aguardando envio'], ['enviada', 'Enviada'], ['recebida', 'Recebida'], ['falha', 'Falha de envio'], ['cancelada', 'Cancelada']],
    },
    { nome: 'pacienteId', rotulo: 'Paciente', tipo: 'ref', ref: 'paciente' },
  ],
  async gerar(f) {
    const linhas = await consultar(
      `select m.id, to_char(m.gerada_em, 'DD/MM/YYYY HH24:MI') gerada, to_char(m.processada_em, 'DD/MM/YYYY HH24:MI') processada, p.nome paciente,
              m.meio, m.destinatario, m.assunto, left(m.texto, 120) texto, m.situacao
         from sis.mensagem m left join cad.pessoa p on p.id = m.paciente_id
        where m.gerada_em::date between $1 and $2 and ($3::text is null or m.meio = $3) and ($4::text is null or m.situacao = $4) and ($5::bigint is null or m.paciente_id = $5)
        order by m.id limit 5000`,
      [f.de, f.ate, f.meio ?? null, f.situacao ?? null, f.pacienteId ?? null],
    );
    return {
      linhas,
      orientacao: 'landscape',
      colunas: [
        { campo: 'id', titulo: 'ID' },
        { campo: 'gerada', titulo: 'Gerada em' },
        { campo: 'processada', titulo: 'Processada em' },
        { campo: 'paciente', titulo: 'Paciente' },
        { campo: 'meio', titulo: 'Meio' },
        { campo: 'destinatario', titulo: 'Destinatário' },
        { campo: 'assunto', titulo: 'Assunto' },
        { campo: 'texto', titulo: 'Texto' },
        { campo: 'situacao', titulo: 'Situação' },
      ],
    };
  },
});
