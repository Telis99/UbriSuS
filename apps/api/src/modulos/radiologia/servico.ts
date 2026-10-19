// Serviços da Radiologia (TR 1.2.45). O fluxo de recepção, execução, laudo, assinatura, impressão e entrega é
// o do núcleo comum (imagem-servico.ts); aqui ficam as regras próprias do serviço de raios X.
import { consultar } from '../../db/pool.js';
import { RAD } from './config.js';

export * from './imagem-servico.js';
export { RAD };

/** Consumo de filmes por tamanho e equipamento, com filmes perdidos/repetições, para a gestão do serviço. */
export async function consumoFilmes(de: string, ate: string, unidadeId: number | null) {
  return consultar(
    `select coalesce(up.nome, '-') unidade, coalesce(eq.nome, '(sem equipamento)') equipamento, coalesce(t.filme_tamanho, '-') tamanho,
            count(*)::int exames, coalesce(sum(t.filmes_quantidade), 0)::int filmes, coalesce(sum(t.filmes_perdidos), 0)::int perdidos,
            count(*) filter (where t.contraste)::int contrastados
       from ${RAD.esquema}.atendimento t left join ${RAD.esquema}.equipamento eq on eq.id = t.equipamento_id left join cad.unidade up on up.id = t.unidade_id
      where t.situacao = 'REALIZADO' and t.data between $1 and $2 and ($3::bigint is null or t.unidade_id = $3)
      group by 1, 2, 3 order by 1, 2, 3`,
    [de, ate, unidadeId],
  );
}
