// Aceites de termos de uso e políticas de cookies por operadores e cidadãos (TR 1.1.1.66, 1.1.1.66.1).
import { consultar } from '../../db/pool.js';
import { PERIODO, registrarRelatorio } from '../../servicos/catalogo.js';

registrarRelatorio({
  id: 'tec-aceites',
  modulo: 'TEC',
  grupo: 'Segurança e LGPD',
  titulo: 'Aceites de termos de uso e política de cookies',
  tr: ['1.1.1.66.1'],
  permissao: 'auditoria:consultar',
  filtros: [
    ...PERIODO,
    { nome: 'tipo', rotulo: 'Tipo', tipo: 'opcao', opcoes: [['cookies', 'Política de cookies'], ['termos_uso', 'Termos de uso (operador)'], ['termos_app', 'Termos do aplicativo (cidadão)']] },
    { nome: 'operadorId', rotulo: 'Operador', tipo: 'ref', ref: 'operador' },
    { nome: 'cidadaoId', rotulo: 'Cidadão', tipo: 'ref', ref: 'paciente' },
  ],
  async gerar(f) {
    const linhas = await consultar(
      `select to_char(a.data_hora, 'DD/MM/YYYY HH24:MI:SS') aceito_em, case a.tipo when 'cookies' then 'Política de cookies' when 'termos_uso' then 'Termos de uso'
              when 'termos_app' then 'Termos do aplicativo' else a.tipo end tipo, a.versao, coalesce(o.nome, p.nome, 'Visitante') quem,
              case when a.operador_id is not null then 'Operador' when a.cidadao_id is not null then 'Cidadão' else 'Não identificado' end perfil, a.ip, left(a.agente, 80) navegador
         from sis.aceite a left join seg.operador o on o.id = a.operador_id left join cad.pessoa p on p.id = a.cidadao_id
        where a.data_hora::date between $1 and $2 and ($3::text is null or a.tipo = $3) and ($4::bigint is null or a.operador_id = $4) and ($5::bigint is null or a.cidadao_id = $5)
        order by a.data_hora desc limit 10000`,
      [f.de, f.ate, f.tipo ?? null, f.operadorId ?? null, f.cidadaoId ?? null],
    );
    return {
      linhas,
      orientacao: 'landscape',
      agrupar: ['tipo'],
      colunas: [
        { campo: 'aceito_em', titulo: 'Data/hora' },
        { campo: 'tipo', titulo: 'Documento' },
        { campo: 'versao', titulo: 'Versão' },
        { campo: 'quem', titulo: 'Nome' },
        { campo: 'perfil', titulo: 'Perfil' },
        { campo: 'ip', titulo: 'IP' },
        { campo: 'navegador', titulo: 'Navegador' },
      ],
    };
  },
});
