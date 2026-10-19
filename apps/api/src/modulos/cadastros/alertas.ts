// Alertas exibidos ao selecionar o paciente em recepção, agendamento, acolhimento,
// atendimento e farmácia. Cada módulo registra seus provedores (vacinas, exames, etc.).
import { consultar, consultarUm } from '../../db/pool.js';
import type { Usuario } from '../../seguranca/usuario.js';
import { config } from '../../config.js';

export interface Alerta {
  tipo: string;
  nivel: 'info' | 'aviso' | 'perigo';
  mensagem: string;
  bloqueante?: boolean;
  dados?: unknown;
}

export interface ContextoAlerta {
  usuario?: Usuario;
  unidadeId?: number | null;
  rotina?: string;
}

type Provedor = (pessoa: Record<string, any>, ctx: ContextoAlerta) => Promise<Alerta[]>;
const provedores: Provedor[] = [];
export function registrarProvedorAlerta(p: Provedor) {
  provedores.push(p);
}

export async function parametro<T>(chave: string, padrao: T): Promise<T> {
  const r = await consultarUm(`select valor from sis.parametro where chave = $1`, [chave]);
  return (r?.valor ?? padrao) as T;
}

export async function gerarAlertas(pessoaId: number, ctx: ContextoAlerta): Promise<Alerta[]> {
  const p = await consultarUm(
    `select p.*, m.codigo_ibge as municipio_ibge, m.nome as municipio_nome from cad.pessoa p
       left join cad.municipio m on m.id = p.municipio_id where p.id = $1`,
    [pessoaId],
  );
  if (!p) return [];
  const resultado: Alerta[] = [];
  for (const prov of provedores) {
    try {
      resultado.push(...(await prov(p, ctx)));
    } catch (e) {
      console.error('provedor de alerta:', e);
    }
  }
  return resultado;
}

// Situação cadastral (TR 1.2.15.8, 1.2.6.16, 1.2.10.19).
registrarProvedorAlerta(async (p) => {
  const a: Alerta[] = [];
  if (p.situacao === 'PRE_CADASTRO') {
    const vencido = p.pre_cadastro_valido_ate && new Date(p.pre_cadastro_valido_ate) < new Date();
    a.push({
      tipo: 'pre_cadastro',
      nivel: vencido ? 'perigo' : 'aviso',
      bloqueante: !!vencido,
      mensagem: vencido
        ? 'Pré-cadastro vencido: atualize o cadastro completo para prosseguir com novo atendimento.'
        : 'Paciente em situação de pré-cadastro: solicite a complementação do cadastro.',
    });
  }
  if (p.situacao === 'FALECIDO') a.push({ tipo: 'falecido', nivel: 'perigo', mensagem: 'Paciente registrado como falecido.' });
  const validade = await parametro<number>('paciente.validade_cadastro_dias', 365);
  if (validade > 0 && p.cadastro_atualizado_em && p.situacao !== 'PRE_CADASTRO') {
    const limite = new Date(p.cadastro_atualizado_em + 'T00:00:00');
    limite.setDate(limite.getDate() + validade);
    if (limite < new Date())
      a.push({
        tipo: 'cadastro_vencido',
        nivel: 'perigo',
        bloqueante: await parametro<boolean>('paciente.bloquear_cadastro_vencido', true),
        mensagem: `Cadastro sem atualização há mais de ${validade} dias. Atualize os dados para prosseguir.`,
      });
  }
  if (p.cartao_sus_disponivel) a.push({ tipo: 'cns_disponivel', nivel: 'info', mensagem: 'Há Cartão Nacional de Saúde disponível para retirada pelo paciente.' });
  if (!p.cns) a.push({ tipo: 'sem_cns', nivel: 'info', mensagem: 'Paciente sem Cartão Nacional de Saúde informado.' });
  return a;
});

// Vínculo com a unidade e residência em outro município (TR 1.2.10.24, 1.2.10.25).
registrarProvedorAlerta(async (p, ctx) => {
  const a: Alerta[] = [];
  if (ctx.unidadeId && (await parametro<boolean>('paciente.alertar_unidade_sem_vinculo', true))) {
    const vinc =
      p.unidade_referencia_id === ctx.unidadeId ||
      (await consultarUm(`select 1 from cad.pessoa_prontuario where pessoa_id = $1 and unidade_id = $2`, [p.id, ctx.unidadeId]));
    if (!vinc) a.push({ tipo: 'sem_vinculo_unidade', nivel: 'aviso', mensagem: 'Paciente sem vínculo cadastral com esta unidade de saúde.' });
  }
  if (p.municipio_ibge && p.municipio_ibge !== config.codigoIbgeMunicipio && (await parametro<boolean>('paciente.alertar_outro_municipio', true))) {
    a.push({ tipo: 'outro_municipio', nivel: 'aviso', mensagem: `Paciente reside em outro município (${p.municipio_nome}).` });
  }
  return a;
});

// Avisos cadastrados para o paciente, filtrados pelo grupo profissional do operador (TR 1.1.2.1.65).
registrarProvedorAlerta(async (p, ctx) => {
  const avisos = await consultar(
    `select id, texto, grupos from cad.pessoa_aviso where pessoa_id = $1 and ativo and not avisado order by criado_em desc`,
    [p.id],
  );
  const grupos = ctx.usuario?.gruposProfissionais ?? [];
  return avisos
    .filter((v) => !v.grupos?.length || v.grupos.includes('TODOS') || v.grupos.some((g: string) => grupos.includes(g)) || ctx.usuario?.administrador)
    .map((v) => ({ tipo: 'aviso_paciente', nivel: 'aviso' as const, mensagem: v.texto, dados: { avisoId: v.id } }));
});
