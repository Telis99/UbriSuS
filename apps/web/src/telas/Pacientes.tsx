// Pacientes (TR 1.2.6): pesquisa, cadastro padrão CADSUS e abas de histórico consolidado no formulário.
import { useState } from 'react';
import { Paper, SegmentedControl, ScrollArea, Stack, Title } from '@mantine/core';
import { api } from '@/api';
import { registrarExtensaoFormulario } from '@/genericos/Formulario';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { BuscaPaciente } from '@/componentes/Paciente';
import { fmtData, fmtDataHora, Situacao, TabelaSimples, useCarregar } from '@/componentes/comum';
import { GraficoEvolucao, HistoricoProntuario } from './Atendimento';
import { registrarTela } from './registro';

const SECOES: [string, string][] = [
  ['agendamentos', 'Agendamentos'],
  ['lista_espera', 'Lista de espera'],
  ['receitas', 'Receitas'],
  ['medicamentos', 'Medicamentos retirados'],
  ['exames', 'Exames'],
  ['procedimentos', 'Procedimentos'],
  ['vacinas', 'Vacinas'],
  ['doencas', 'Doenças (CID)'],
  ['agravos', 'Agravos notificados'],
  ['familia', 'Família'],
  ['contatos', 'Contatos'],
  ['avisos', 'Avisos'],
  ['tfd', 'TFD'],
  ['aih', 'AIH'],
  ['transporte', 'Transporte'],
];

const ROTULOS: Record<string, string> = {
  data: 'Data',
  data_hora: 'Data/hora',
  incluido_em: 'Incluído em',
  criado_em: 'Criado em',
  data_saida: 'Saída',
  data_nascimento: 'Nascimento',
  resultado_liberado_em: 'Resultado em',
  termino_previsto: 'Término previsto',
  avisado_em: 'Avisado em',
};

const ehData = (k: string) => /^data|_em$|termino_previsto/.test(k);

/** Histórico consolidado do paciente por seção (TR 1.2.6.31 a 1.2.6.59). */
export function HistoricoPaciente({ pacienteId }: { pacienteId: number }) {
  const [secao, setSecao] = useState('agendamentos');
  const { dados } = useCarregar<any[]>(() => api.get(`/api/pacientes/${pacienteId}/historico/${secao}`), [pacienteId, secao]);
  const linhas = dados ?? [];
  const chaves = linhas.length ? Object.keys(linhas[0]).filter((k) => !k.endsWith('_id') && k !== 'id') : [];
  return (
    <Stack gap="xs">
      <ScrollArea type="auto">
        <SegmentedControl size="xs" value={secao} onChange={setSecao} data={SECOES.map(([value, label]) => ({ value, label }))} />
      </ScrollArea>
      <TabelaSimples
        linhas={linhas}
        colunas={chaves.map((k) => ({
          titulo: ROTULOS[k] ?? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
          valor: (l: any) => {
            const v = l[k];
            if (v == null) return '';
            if (k === 'situacao') return <Situacao valor={v} />;
            if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
            if (ehData(k)) return String(v).length > 10 ? fmtDataHora(v) : fmtData(v);
            return String(v);
          },
        }))}
      />
    </Stack>
  );
}

registrarExtensaoFormulario('paciente', {
  // Atendimentos e medidas clínicas só para quem tem acesso ao prontuário (LGPD, TR 1.1.1.35).
  abasExtras: (r, pode) =>
    r?.id
      ? [
          { titulo: 'Histórico', conteudo: <HistoricoPaciente pacienteId={r.id} /> },
          ...(pode('prontuario:consultar', 'PEP')
            ? [
                { titulo: 'Atendimentos', conteudo: <HistoricoProntuario pacienteId={r.id} /> },
                { titulo: 'Evolução', conteudo: <GraficoEvolucao pacienteId={r.id} /> },
              ]
            : []),
        ]
      : [],
});

function TelaPacientes() {
  useTituloJanela('Pacientes');
  const { abrir } = useJanelas();
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Pacientes</Title>
      <Paper withBorder p="sm">
        <BuscaPaciente aoSelecionar={(id) => abrir(`/e/paciente/${id}`, 'Paciente')} />
      </Paper>
    </Stack>
  );
}

registrarTela({
  id: 'pacientes',
  titulo: 'Pesquisar pacientes',
  menu: 'Prontuário',
  padrao: '/t/pacientes',
  permissao: 'paciente:consultar',
  modulo: 'AGE',
  palavras: ['cadastro', 'cadsus', 'cartão sus', 'prontuário', 'histórico'],
  ordem: 1,
  render: () => <TelaPacientes />,
});

