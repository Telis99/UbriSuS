// Dados fictícios para demonstração e prova de conceito (nenhuma pessoa real).
// Executado com: npm run db:seed -- --demo
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { config } from '../../config.js';
import { gerarHashSenha } from '../../seguranca/senha.js';
import { gerarHorarios } from '../../modulos/agendamento/servico.js';
import { cargasDemonstracao } from './modulos.js';

export const SENHA_DEMO = 'Saude@2026';

export function gerarCpf(): string {
  const n = Array.from({ length: 9 }, () => randomInt(10));
  for (const t of [9, 10]) {
    const soma = n.reduce((s, d, i) => s + d * (t + 1 - i), 0);
    n.push(((soma * 10) % 11) % 10);
  }
  return n.join('');
}

export function gerarCns(): string {
  for (;;) {
    const n = [7, ...Array.from({ length: 13 }, () => randomInt(10))];
    const soma = n.reduce((s, d, i) => s + d * (15 - i), 0);
    const dv = (11 - (soma % 11)) % 11;
    if (dv < 10) return [...n, dv].join('');
  }
}

const NOMES_F = ['ANA', 'MARIA', 'JULIANA', 'FERNANDA', 'PATRÍCIA', 'ALINE', 'CAMILA', 'LETÍCIA', 'BEATRIZ', 'LARISSA', 'VITÓRIA', 'HELENA', 'ALICE', 'LUANA', 'TEREZA', 'CLARA'];
const NOMES_M = ['JOSÉ', 'JOÃO', 'ANTÔNIO', 'FRANCISCO', 'CARLOS', 'PAULO', 'PEDRO', 'LUCAS', 'MATEUS', 'RAFAEL', 'GABRIEL', 'MIGUEL', 'ARTHUR', 'DAVI', 'BENEDITO', 'SEBASTIÃO'];
const SOBRENOMES = ['SILVA', 'SANTOS', 'OLIVEIRA', 'SOUZA', 'RODRIGUES', 'FERREIRA', 'ALVES', 'PEREIRA', 'LIMA', 'GOMES', 'COSTA', 'RIBEIRO', 'MARTINS', 'CARVALHO', 'ALMEIDA', 'LOPES', 'SOARES', 'VIEIRA', 'BARBOSA', 'ROCHA'];
const sorteia = <T>(l: T[]) => l[randomInt(l.length)];

async function idUnidade(c: pg.PoolClient, prefixo: string) {
  return (await c.query(`select id from cad.unidade where nome like $1 order by id limit 1`, [prefixo + '%'])).rows[0]?.id as number;
}

async function criarPessoa(c: pg.PoolClient, d: { nome: string; sexo: string; nascimento: string; mae?: string; email?: string; bairroId?: number; municipioId: number; unidadeId?: number; celular?: string; condicoes?: string[] }) {
  return (
    await c.query(
      `insert into cad.pessoa (nome, sexo, data_nascimento, raca_cor, nome_mae, cpf, cns, municipio_id, bairro_id, situacao, email, celular, unidade_referencia_id, condicoes_saude, notificar_sms)
       values ($1,$2,$3,'03',$4,$5,$6,$7,$8,'ATIVO',$9,$10,$11,$12,true) returning id`,
      [d.nome, d.sexo, d.nascimento, d.mae ?? `${sorteia(NOMES_F)} ${sorteia(SOBRENOMES)}`, gerarCpf(), gerarCns(), d.municipioId, d.bairroId ?? null, d.email ?? null, d.celular ?? `119${String(randomInt(10_000_000, 99_999_999))}`, d.unidadeId ?? null, d.condicoes ?? null],
    )
  ).rows[0].id as number;
}

export async function carregarDemonstracao(c: pg.PoolClient) {
  const existe = (await c.query(`select 1 from seg.operador where login = 'medico'`)).rowCount;
  if (existe) {
    console.log('  dados de demonstração já carregados');
    return;
  }
  const mun = (await c.query(`select id from cad.municipio where codigo_ibge = $1`, [config.codigoIbgeMunicipio])).rows[0].id;
  const bairros = (await c.query(`select id from cad.bairro where municipio_id = $1`, [mun])).rows.map((r) => r.id);
  const usf = await idUnidade(c, 'USF HERMÓGENES');
  const usf2 = await idUnidade(c, 'USF IRMÃO BRUNO');
  const upa = await idUnidade(c, 'UPA');
  const cem = await idUnidade(c, 'CEM');
  const ceo = await idUnidade(c, 'CEO');
  const almox = await idUnidade(c, 'ALMOXARIFADO');
  const sms = await idUnidade(c, 'SECRETARIA');
  const caps = await idUnidade(c, 'CAPS');
  await c.query(`update cad.unidade set cnes = lpad(id::text, 7, '9') where cnes is null`);
  const cbo = async (codigo: string) => (await c.query(`select id from cad.cbo where codigo = $1`, [codigo])).rows[0].id;
  const esp = async (nome: string) => (await c.query(`select id from cad.especialidade where nome = $1`, [nome])).rows[0].id;
  const perfil = async (nome: string) => (await c.query(`select id from seg.perfil where nome = $1`, [nome])).rows[0].id;
  const hash = await gerarHashSenha(SENHA_DEMO);

  const profissionais: Record<string, number> = {};
  const equipe = [
    { chave: 'medico', nome: 'CARLOS EDUARDO ANDRADE', sexo: 'M', nasc: '1978-04-12', conselho: 'CRM', registro: '123456', cbo: '225142', esp: 'MEDICINA DE FAMÍLIA', unidades: [usf, upa], perfil: 'Médico' },
    { chave: 'pediatra', nome: 'BEATRIZ HELENA LIMA', sexo: 'F', nasc: '1983-09-02', conselho: 'CRM', registro: '234567', cbo: '225124', esp: 'PEDIATRIA', unidades: [cem], perfil: 'Médico' },
    { chave: 'ginecologista', nome: 'PAULA CRISTINA REIS', sexo: 'F', nasc: '1980-01-20', conselho: 'CRM', registro: '345678', cbo: '225250', esp: 'GINECOLOGIA E OBSTETRÍCIA', unidades: [cem], perfil: 'Médico' },
    { chave: 'plantonista', nome: 'RICARDO MENDES FARIAS', sexo: 'M', nasc: '1986-06-30', conselho: 'CRM', registro: '456789', cbo: '225125', esp: 'CLÍNICA MÉDICA - PRONTO ATENDIMENTO', unidades: [upa], perfil: 'Médico' },
    { chave: 'enfermeira', nome: 'ANA CAROLINA SOUZA', sexo: 'F', nasc: '1990-03-15', conselho: 'COREN', registro: '567890', cbo: '223565', esp: 'ENFERMAGEM', unidades: [usf, upa], perfil: 'Enfermagem' },
    { chave: 'dentista', nome: 'MARCOS VINÍCIUS TEIXEIRA', sexo: 'M', nasc: '1982-11-08', conselho: 'CRO', registro: '678901', cbo: '223208', esp: 'ODONTOLOGIA - CLÍNICO GERAL', unidades: [ceo, usf], perfil: 'Odontologia' },
    { chave: 'farmaceutica', nome: 'JULIANA PRADO NOGUEIRA', sexo: 'F', nasc: '1988-07-22', conselho: 'CRF', registro: '789012', cbo: '223405', esp: null, unidades: [almox, usf], perfil: 'Farmácia' },
    { chave: 'acs', nome: 'PEDRO HENRIQUE ALVES', sexo: 'M', nasc: '1995-02-14', conselho: null, registro: null, cbo: '515105', esp: null, unidades: [usf], perfil: 'Agente comunitário de saúde' },
    { chave: 'psicologa', nome: 'RENATA DUARTE CAMPOS', sexo: 'F', nasc: '1987-05-05', conselho: 'CRP', registro: '06/12345', cbo: '251510', esp: 'PSICOLOGIA', unidades: [caps], perfil: 'Médico' },
  ];
  for (const p of equipe) {
    const pessoa = await criarPessoa(c, { nome: p.nome, sexo: p.sexo, nascimento: p.nasc, municipioId: mun, email: `${p.chave}@saude.exemplo.gov.br` });
    const prof = (
      await c.query(
        `insert into cad.profissional (pessoa_id, conselho, registro_conselho, uf_conselho, autorizador_aih, liberador_laudo, regulador, solicitante_exames, ativo)
         values ($1,$2,$3,'SP',$4,$5,$6,true,true) returning id`,
        [pessoa, p.conselho, p.registro, p.chave === 'medico', p.chave === 'farmaceutica', p.chave === 'ginecologista'],
      )
    ).rows[0].id;
    profissionais[p.chave] = prof;
    for (const un of p.unidades) {
      await c.query(
        `insert into cad.vinculo (profissional_id, unidade_id, cbo_id, especialidade_id, conselho, registro_conselho, uf_conselho, carga_horaria, ativo, data_inicio)
         values ($1,$2,$3,$4,$5,$6,'SP',40,true,'2024-01-01')`,
        [prof, un, await cbo(p.cbo), p.esp ? await esp(p.esp) : null, p.conselho, p.registro],
      );
    }
    const op = (
      await c.query(
        `insert into seg.operador (pessoa_id, login, senha_hash, senha_alterada_em, profissional_id, termos_aceitos_em, unidade_padrao_id, ativo, validar_vinculo)
         values ($1,$2,$3,now(),$4,now(),$5,true,true) returning id`,
        [pessoa, p.chave, hash, prof, p.unidades[0]],
      )
    ).rows[0].id;
    await c.query(`insert into seg.operador_perfil (operador_id, perfil_id) values ($1,$2)`, [op, await perfil(p.perfil)]);
    for (const un of p.unidades) await c.query(`insert into seg.operador_unidade (operador_id, unidade_id) values ($1,$2)`, [op, un]);
  }
  // Recepcionista e gestor.
  for (const [login, nome, perf, unidades] of [
    ['recepcao', 'MARIANA COSTA RECEPÇÃO', 'Recepção e agendamento', [usf, upa, cem]],
    ['gestor', 'ROBERTO LIMA GESTÃO', 'Gestor da saúde', [sms, usf, upa, cem]],
  ] as [string, string, string, number[]][]) {
    const pessoa = await criarPessoa(c, { nome, sexo: 'F', nascimento: '1985-01-01', municipioId: mun, email: `${login}@saude.exemplo.gov.br` });
    const op = (
      await c.query(
        `insert into seg.operador (pessoa_id, login, senha_hash, senha_alterada_em, termos_aceitos_em, unidade_padrao_id, ativo) values ($1,$2,$3,now(),now(),$4,true) returning id`,
        [pessoa, login, hash, unidades[0]],
      )
    ).rows[0].id;
    await c.query(`insert into seg.operador_perfil (operador_id, perfil_id) values ($1,$2)`, [op, await perfil(perf)]);
    for (const un of unidades) await c.query(`insert into seg.operador_unidade (operador_id, unidade_id) values ($1,$2)`, [op, un]);
  }

  // Pacientes fictícios, distribuídos em famílias.
  const pacientes: number[] = [];
  for (let i = 0; i < 40; i++) {
    const fem = i % 2 === 0;
    const idade = [0, 1, 4, 8, 15, 22, 29, 35, 41, 48, 55, 62, 67, 74, 81][i % 15];
    const ano = new Date().getFullYear() - idade;
    const nome = `${sorteia(fem ? NOMES_F : NOMES_M)} ${sorteia(SOBRENOMES)} ${sorteia(SOBRENOMES)}`;
    const condicoes = idade > 50 && i % 3 === 0 ? ['hipertensao'] : idade > 45 && i % 4 === 1 ? ['diabetes', 'hipertensao'] : null;
    try {
      pacientes.push(
        await criarPessoa(c, {
          nome,
          sexo: fem ? 'F' : 'M',
          nascimento: `${ano}-${String(randomInt(1, 13)).padStart(2, '0')}-${String(randomInt(1, 28)).padStart(2, '0')}`,
          municipioId: mun,
          bairroId: bairros.length ? sorteia(bairros) : undefined,
          unidadeId: i % 3 === 0 ? usf2 : usf,
          condicoes: condicoes ?? undefined,
        }),
      );
    } catch {
      /* nome repetido: ignora */
    }
  }
  await c.query(`insert into cad.pessoa_alergia (pessoa_id, tipo, substancia, gravidade) values ($1, 'MEDICAMENTO', 'DIPIRONA', 'GRAVE')`, [pacientes[2]]);
  for (const p of pacientes) await c.query(`insert into cad.pessoa_prontuario (pessoa_id, unidade_id, numero) values ($1,$2,$3) on conflict do nothing`, [p, usf, String(1000 + p)]);

  // Filas e painéis de chamada.
  const filas: [number, string, string, string, boolean, string][] = [
    [usf, 'Acolhimento', 'ACOLHIMENTO', 'A', true, 'RISCO'],
    [usf, 'Consultas', 'CONSULTA', 'C', true, 'HORARIO'],
    [usf, 'Vacinação', 'VACINA', 'V', false, 'CHEGADA'],
    [usf, 'Farmácia', 'FARMACIA', 'F', false, 'CHEGADA'],
    [usf, 'Curativos e procedimentos', 'CURATIVO', 'P', false, 'CHEGADA'],
    [upa, 'Pronto atendimento', 'URGENCIA', 'U', true, 'RISCO'],
    [cem, 'Consultas especializadas', 'CONSULTA', 'E', false, 'HORARIO'],
    [ceo, 'Odontologia', 'ODONTOLOGIA', 'O', false, 'HORARIO'],
  ];
  for (const [un, nome, tipo, pref, triagem, ordem] of filas) {
    await c.query(`insert into amb.fila (unidade_id, nome, tipo, prefixo_senha, exige_triagem, ordenacao, ordenacao_fixa, ativo) values ($1,$2,$3,$4,$5,$6,$7,true)`, [
      un,
      nome,
      tipo,
      pref,
      triagem,
      ordem,
      tipo === 'URGENCIA',
    ]);
  }
  for (const [un, nome, chave] of [
    [usf, 'Painel da recepção - USF', 'demo-usf'],
    [upa, 'Painel da UPA', 'demo-upa'],
  ] as [number, string, string][]) {
    await c.query(
      `insert into amb.painel_chamada (nome, unidade_id, tipos_chamada, exibir_profissional, voz, frase, estatisticas, mostrar_anteriores, mensagens, chave_acesso, ativo, cor_fundo, cor_texto, cor_destaque)
       values ($1,$2,'{}',true,true,'{nome}, dirija-se ao {local}','{AGUARDANDO,ATENDIDOS,TEMPO_MEDIO}',true,$3,$4,true,'#0f3d78','#ffffff','#ffd43b')`,
      [nome, un, 'Mantenha sua carteira de vacinação em dia.\nAgende consultas pelo aplicativo da Saúde.', chave],
    );
  }
  for (const [un, nome, tipo] of [
    [usf, 'Consultório 1', 'CONSULTORIO'],
    [usf, 'Consultório 2', 'CONSULTORIO'],
    [usf, 'Sala de acolhimento', 'TRIAGEM'],
    [usf, 'Sala de vacina', 'VACINA'],
    [upa, 'Classificação de risco', 'TRIAGEM'],
    [upa, 'Consultório 1', 'CONSULTORIO'],
    [upa, 'Observação', 'OBSERVACAO'],
  ] as [number, string, string][]) {
    await c.query(`insert into cad.sala (unidade_id, nome, tipo, ativo) values ($1,$2,$3,true)`, [un, nome, tipo]);
  }

  // Agendas.
  const hoje = new Date().toISOString().slice(0, 10);
  const agendas: [number, number | null, number | null, string, string, string, number, number, number, string[], string][] = [
    [usf, profissionais.medico, await esp('MEDICINA DE FAMÍLIA'), 'CONSULTA', '07:00', '11:00', 16, 2, 0, ['1', '2', '3', '4', '5'], '#3075d4'],
    [cem, profissionais.pediatra, await esp('PEDIATRIA'), 'CONSULTA', '13:00', '17:00', 12, 2, 0, ['2', '4'], '#7950f2'],
    [cem, profissionais.ginecologista, await esp('GINECOLOGIA E OBSTETRÍCIA'), 'CONSULTA', '08:00', '12:00', 10, 1, 2, ['3', '5'], '#e64980'],
    [ceo, profissionais.dentista, await esp('ODONTOLOGIA - CLÍNICO GERAL'), 'CONSULTA', '08:00', '12:00', 8, 1, 0, ['1', '3', '5'], '#12b886'],
    [caps, profissionais.psicologa, await esp('PSICOLOGIA'), 'CONSULTA', '13:00', '17:00', 8, 0, 0, ['1', '2', '3', '4'], '#fab005'],
  ];
  for (const [un, prof, e, tipo, hi, hf, vagas, urg, reg, dias, cor] of agendas) {
    const a = (
      await c.query(
        `insert into age.agenda (nome, tipo, unidade_id, profissional_id, especialidade_id, cor, vigencia_inicio, dias_semana, intervalo_semanas, hora_inicio, hora_fim, vagas, vagas_urgencia, vagas_regulacao, disponivel_web, ativo)
         values ((select e.nome || ' - ' || p.nome from cad.especialidade e, cad.profissional p where e.id = $4 and p.id = $3),$1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12,true,true) returning id`,
        [tipo, un, prof, e, cor, hoje, dias, hi, hf, vagas, urg, reg],
      )
    ).rows[0].id;
    await gerarHorarios(c, a, 60);
  }
  // Agenda de exames do prestador (laboratório e imagem no CEM) com cotas.
  const agExames = (
    await c.query(
      `insert into age.agenda (nome, tipo, unidade_id, local, cor, vigencia_inicio, dias_semana, intervalo_semanas, hora_inicio, hora_fim, vagas, vagas_urgencia, vagas_regulacao, por_ordem_chegada, ativo)
       values ('COLETA DE EXAMES LABORATORIAIS - CEM','EXAME',$1,'Sala de coleta','#fd7e14',$2,'{1,2,3,4,5}',1,'07:00','09:00',30,5,0,true,true) returning id`,
      [cem, hoje],
    )
  ).rows[0].id;
  for (const [codigo, cota] of [
    ['0202020380', 25],
    ['0202010473', 25],
    ['0202010295', 20],
    ['0202010279', 20],
    ['0202010678', 20],
    ['0202010317', 20],
    ['0202050017', 15],
  ] as [string, number][]) {
    await c.query(`insert into age.agenda_procedimento (agenda_id, procedimento_id, cota_diaria) select $1, id, $3 from cad.procedimento where codigo = $2`, [agExames, codigo, cota]);
  }
  await gerarHorarios(c, agExames, 60);
  const agImagem = (
    await c.query(
      `insert into age.agenda (nome, tipo, unidade_id, local, cor, vigencia_inicio, dias_semana, intervalo_semanas, hora_inicio, hora_fim, vagas, vagas_urgencia, vagas_regulacao, ativo)
       values ('ULTRASSONOGRAFIA - CEM','EXAME',$1,'Sala de ultrassom','#15aabf',$2,'{2,4}',1,'08:00','12:00',12,0,4,true) returning id`,
      [cem, hoje],
    )
  ).rows[0].id;
  for (const codigo of ['0205020046', '0205020186']) {
    await c.query(`insert into age.agenda_procedimento (agenda_id, procedimento_id, cota_diaria, cota_mensal) select $1, id, 8, 100 from cad.procedimento where codigo = $2`, [agImagem, codigo]);
  }
  await gerarHorarios(c, agImagem, 60);

  await c.query(
    `insert into age.criterio_notificacao (nome, eventos, meio, tipo_agenda, dias_antecedencia, assunto, texto, ativo)
     values ('Avisos de agendamento', '{AGENDAMENTO,LISTA_ESPERA,TRANSFERENCIA,CANCELAMENTO}', 'TODOS', 'TODAS', 1, 'Secretaria Municipal de Saúde',
             'Olá, {paciente}. {evento}: {tipo} em {data} às {hora} - {local}. Protocolo {senha}. {motivo}', true),
            ('Lembrete de consulta', '{LEMBRETE}', 'SMS', 'TODAS', 1, 'Lembrete', 'Olá, {paciente}. Lembrete: {tipo} amanhã ({data}) às {hora} em {local}.', true)`,
  );
  await c.query(`update cad.especialidade set regulada = true where nome in ('GINECOLOGIA E OBSTETRÍCIA', 'CARDIOLOGIA', 'ORTOPEDIA', 'NEUROLOGIA')`);
  await c.query(`insert into cad.feriado (data, descricao, tipo, rotas_afetadas) values ('2026-11-20', 'Dia da Consciência Negra', 'NACIONAL', 'TODAS'), ('2026-12-25', 'Natal', 'NACIONAL', 'TODAS') on conflict do nothing`);
  for (const [, carga] of cargasDemonstracao) await carga(c, { pacientes, profissionais, unidades: { usf, usf2, upa, cem, ceo, almox, sms, caps } });
  console.log(`  ${pacientes.length} pacientes, ${equipe.length + 2} operadores (senha ${SENHA_DEMO}), agendas e filas criadas`);
}
