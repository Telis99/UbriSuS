// Serviços da Ecografia (TR 1.2.50). O fluxo de recepção, execução, laudo, assinatura, impressão e entrega é o
// do núcleo comum de diagnóstico por imagem; aqui ficam as consultas próprias do serviço de ultrassonografia.
import { consultar } from '../../db/pool.js';
import { ECO } from './config.js';

export * from '../radiologia/imagem-servico.js';
export { ECO };

/** Status do laudo dos exames: não digitado, digitado e impresso (TR 1.2.50.8.4), por exame no período. */
export async function statusLaudos(de: string, ate: string, unidadeId: number | null) {
  return consultar(
    `select coalesce(up.nome, '-') unidade, coalesce(e.nome, pr.nome) exame,
            count(*) filter (where t.situacao_laudo = 'NAO_DIGITADO')::int nao_digitados,
            count(*) filter (where t.situacao_laudo = 'DIGITADO')::int digitados,
            count(*) filter (where t.situacao_laudo in ('ASSINADO','ANEXADO'))::int liberados,
            count(*) filter (where t.situacao_laudo = 'IMPRESSO')::int impressos
       from ${ECO.esquema}.atendimento t join ${ECO.esquema}.exame e on e.id = t.exame_id left join cad.procedimento pr on pr.id = t.procedimento_id
       left join cad.unidade up on up.id = t.unidade_id
      where t.situacao = 'REALIZADO' and t.data between $1 and $2 and ($3::bigint is null or t.unidade_id = $3)
      group by 1, 2 order by 1, 2`,
    [de, ate, unidadeId],
  );
}
