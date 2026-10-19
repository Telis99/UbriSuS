// Informações de saúde no aplicativo: vacinas (TR 1.2.41.8), medicamentos (TR 1.2.41.9), exames (TR 1.2.41.10)
// e históricos de atendimentos médicos, odontológicos e de enfermagem (TR 1.2.41.11 a 1.2.41.13).
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Accordion, Alert, Badge, Button, Divider, Group, SegmentedControl, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconBuildingHospital, IconCalendarEvent, IconFileDescription, IconFlask, IconMedicineSyrup, IconPill, IconPrinter, IconSearch, IconStethoscope, IconVaccine } from '@tabler/icons-react';
import { api } from '@/api';
import { abrirDocumento, Cartao, Estado, Etiqueta, fmtData, fmtDataHora, Secao, useCidadao, useDados } from './comum';

// ---------------------------------------------------------------- vacinas

const COR_VACINA: Record<string, string> = { APLICADA: 'blue', RESGATADA: 'blue', APRAZADA: 'teal', INDICADA: 'teal', NO_PRAZO: 'green', ATRASADA: 'red', FUTURA: 'gray', SEM_EFEITO: 'gray' };
const NOME_VACINA: Record<string, string> = { APLICADA: 'Aplicada', RESGATADA: 'Resgatada', APRAZADA: 'Aprazada', INDICADA: 'Indicada', NO_PRAZO: 'Pode tomar', ATRASADA: 'Em atraso', FUTURA: 'Futura', SEM_EFEITO: 'Fora da idade' };

export function Vacinas() {
  const { pessoa } = useCidadao();
  const { dados, erro, carregando } = useDados<any>(pessoa ? `/api/cidadao/vacinas?pessoaId=${pessoa.id}` : null, [pessoa?.id]);
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Vacinas</Title>
        {/* Impressão da carteira do titular ou do dependente (TR 1.2.41.8.2). */}
        <Button size="xs" variant="light" leftSection={<IconPrinter size={14} />} onClick={() => abrirDocumento(`/api/cidadao/vacinas/carteira?pessoaId=${pessoa?.id}`)} disabled={!dados}>
          Imprimir carteira
        </Button>
      </Group>
      <Estado erro={erro} carregando={carregando}>
        {dados && (
          <>
            {dados.campanhas.length > 0 && (
              <Secao titulo="Campanhas em aberto" icone={<IconVaccine size={16} />}>
                {dados.campanhas.map((c: any) => (
                  <Cartao key={c.id} cor="grape">
                    <Text fw={600}>{c.nome}</Text>
                    <Text size="xs" c="dimmed">
                      {fmtData(c.inicio)} a {fmtData(c.fim)}
                    </Text>
                    {c.grupos.map((g: any, i: number) => (
                      <Group key={i} gap={6} mt={4}>
                        <Text size="sm">
                          {[g.grupo, g.imunobiologico].filter(Boolean).join(' — ')} {g.dose ? `(${g.dose})` : ''}
                        </Text>
                        {g.indicada ? <Badge color="grape" size="xs">Indicada para {pessoa?.nome.split(' ')[0]}</Badge> : <Badge color="gray" size="xs" variant="light">Outro público</Badge>}
                      </Group>
                    ))}
                  </Cartao>
                ))}
              </Secao>
            )}
            <Secao titulo="Próximas vacinas e aprazamentos" icone={<IconCalendarEvent size={16} />}>
              {!dados.proximas.length && <Estado vazio />}
              {dados.proximas.slice(0, 12).map((i: any) => (
                <Group key={`${i.imunobiologicoId}-${i.doseId}`} justify="space-between" wrap="nowrap">
                  <Stack gap={0}>
                    <Text size="sm" fw={600}>
                      {i.imunobiologico} — {i.dose}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {i.situacao === 'APRAZADA' ? `Aprazada para ${fmtData(i.registro?.data_aprazada ?? i.registro?.data)}` : `Indicada a partir de ${fmtData(i.previstoPara)}`}
                    </Text>
                  </Stack>
                  <Badge color={COR_VACINA[i.situacao]} variant="light" style={{ flexShrink: 0 }}>
                    {NOME_VACINA[i.situacao]}
                  </Badge>
                </Group>
              ))}
            </Secao>
            <Secao titulo="Histórico de vacinação" icone={<IconVaccine size={16} />}>
              {!dados.aplicadas.length && <Estado vazio />}
              <Stack gap={6}>
                {[...dados.aplicadas].reverse().map((a: any) => (
                  <Cartao key={a.id} cor="blue">
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={600} size="sm">
                        {a.imunobiologico}
                      </Text>
                      <Badge variant="light">{a.dose ?? '-'}</Badge>
                    </Group>
                    <Text size="xs">
                      {fmtData(a.data)} · {a.unidade ?? '-'} · lote {a.lote ?? '-'}
                    </Text>
                    {a.profissional && (
                      <Text size="xs" c="dimmed">
                        Vacinador(a): {a.profissional}
                      </Text>
                    )}
                  </Cartao>
                ))}
              </Stack>
            </Secao>
          </>
        )}
      </Estado>
    </Stack>
  );
}

// ---------------------------------------------------------------- medicamentos

export function Medicamentos() {
  const { pessoa } = useCidadao();
  const [aba, setAba] = useState<string | null>('uso');
  const { dados, erro, carregando } = useDados<any>(pessoa ? `/api/cidadao/medicamentos?pessoaId=${pessoa.id}` : null, [pessoa?.id]);
  return (
    <Stack gap="md">
      <Title order={3}>Medicamentos</Title>
      <Tabs value={aba} onChange={setAba} variant="pills" radius="xl">
        <Tabs.List grow>
          <Tabs.Tab value="uso">Em uso</Tabs.Tab>
          <Tabs.Tab value="historico">Histórico</Tabs.Tab>
          <Tabs.Tab value="farmacias">Farmácias</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="uso" pt="sm">
          <Estado erro={erro} carregando={carregando} vazio={!dados?.emUso?.length}>
            <Stack gap={6}>
              {dados?.emUso.map((m: any) => (
                <Cartao key={m.id} cor="teal">
                  <Group justify="space-between" wrap="nowrap">
                    <Text fw={600}>{m.medicamento}</Text>
                    {m.uso_continuo && <Badge color="teal">Uso contínuo</Badge>}
                  </Group>
                  <Text size="sm">{m.posologia ?? m.dose}</Text>
                  <Text size="xs" c="dimmed">
                    Desde {fmtData(m.inicio)}
                    {m.termino ? ` até ${fmtData(m.termino)}` : ''} · {m.prescritor} · {m.unidade}
                  </Text>
                  {m.orientacoes && (
                    <Text size="xs" mt={4}>
                      Recomendações: {m.orientacoes}
                    </Text>
                  )}
                </Cartao>
              ))}
            </Stack>
          </Estado>
        </Tabs.Panel>
        <Tabs.Panel value="historico" pt="sm">
          <Estado erro={erro} carregando={carregando} vazio={!dados?.historico?.length}>
            <Table.ScrollContainer minWidth={480}>
              <Table striped fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Medicamento</Table.Th>
                    <Table.Th>Posologia</Table.Th>
                    <Table.Th>Início</Table.Th>
                    <Table.Th>Término</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {dados?.historico.map((m: any) => (
                    <Table.Tr key={m.id}>
                      <Table.Td>{m.medicamento}</Table.Td>
                      <Table.Td>{m.posologia}</Table.Td>
                      <Table.Td>{fmtData(m.inicio)}</Table.Td>
                      <Table.Td>{m.uso_continuo ? 'Uso contínuo' : fmtData(m.termino ?? m.termino_dispensado) || '-'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {dados?.dispensacoes?.length > 0 && (
              <Text size="xs" c="dimmed" mt="xs">
                Última retirada na farmácia: {dados.dispensacoes[0].medicamento} em {fmtDataHora(dados.dispensacoes[0].data_hora)} ({dados.dispensacoes[0].unidade}).
              </Text>
            )}
          </Estado>
        </Tabs.Panel>
        <Tabs.Panel value="farmacias" pt="sm">
          <Disponibilidade />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

/** Medicamentos disponíveis nas farmácias do município, conforme parametrização de cada item (TR 1.2.41.9.3). */
export function Disponibilidade() {
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const { dados, erro, carregando } = useDados<any[]>(`/api/cidadao/medicamentos-disponiveis${termo ? `?q=${encodeURIComponent(termo)}` : ''}`, [termo]);
  return (
    <Stack gap="xs">
      <TextInput placeholder="Buscar medicamento" leftSection={<IconSearch size={14} />} value={busca} onChange={(e) => setBusca(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && setTermo(busca)} onBlur={() => setTermo(busca)} />
      <Estado erro={erro} carregando={carregando} vazio={!dados?.length}>
        <Accordion variant="separated" radius="md">
          {dados?.map((m) => (
            <Accordion.Item key={m.id} value={String(m.id)}>
              <Accordion.Control icon={<IconPill size={16} />}>
                <Group justify="space-between" wrap="nowrap" pr="xs">
                  <Text size="sm">{m.nome}</Text>
                  <Badge color={m.disponivel ? 'teal' : 'red'} variant="light" size="sm">
                    {m.disponivel ? 'Disponível' : 'Em falta'}
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                {!m.farmacias.length && <Text size="sm">Sem estoque nas farmácias no momento.</Text>}
                {m.farmacias.map((f: any) => (
                  <Group key={f.unidadeId} gap={6}>
                    <IconBuildingHospital size={14} />
                    <Text size="sm">
                      {f.unidade}
                      {f.quantidade != null ? ` — ${f.quantidade} ${m.unidadeFornecimento ?? 'un.'}` : ''}
                    </Text>
                  </Group>
                ))}
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Estado>
    </Stack>
  );
}

// ---------------------------------------------------------------- exames

function ResultadoExame({ item }: { item: any }) {
  const [res, setRes] = useState<any>(null);
  const ver = async () => setRes(await api.get(`/api/cidadao/exames/${item.id}/resultado`));
  if (!item.resultado_liberado_em) return <Text size="xs" c="dimmed">Resultado ainda não liberado.</Text>;
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Button size="xs" variant="light" leftSection={<IconFileDescription size={14} />} onClick={ver}>
          Ver resultado
        </Button>
        <Button size="xs" variant="subtle" leftSection={<IconPrinter size={14} />} onClick={() => abrirDocumento(`/api/cidadao/exames/${item.id}/impressao`)}>
          Imprimir
        </Button>
        {item.tem_laudo && (
          <Button size="xs" variant="subtle" onClick={() => abrirDocumento(`/api/cidadao/exames/${item.id}/laudo`)}>
            Laudo
          </Button>
        )}
      </Group>
      {res && (
        <Alert color="teal" variant="light" title={`${res.exame} — liberado em ${fmtDataHora(res.liberadoEm)}`}>
          <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
            {res.resultado ?? 'Resultado disponível no laudo digitalizado.'}
          </Text>
        </Alert>
      )}
    </Stack>
  );
}

export function Exames() {
  const { pessoa } = useCidadao();
  const { dados, erro, carregando } = useDados<any>(pessoa ? `/api/cidadao/exames?pessoaId=${pessoa.id}` : null, [pessoa?.id]);
  return (
    <Stack gap="md">
      <Title order={3}>Exames</Title>
      <Estado erro={erro} carregando={carregando}>
        {dados && (
          <Tabs defaultValue="agendados" variant="pills" radius="xl">
            <Tabs.List grow>
              <Tabs.Tab value="agendados">Agendados</Tabs.Tab>
              <Tabs.Tab value="realizados">Resultados</Tabs.Tab>
              <Tabs.Tab value="pedidos">Pedidos</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="agendados" pt="sm">
              <Stack gap={6}>
                {!dados.agendados.length && <Estado vazio />}
                {dados.agendados.map((e: any, i: number) => (
                  <Cartao key={i} cor="blue">
                    <Text fw={600}>{e.exame}</Text>
                    {e.agendamento ? (
                      <Text size="sm">
                        {fmtData(e.agendamento.data)} {e.agendamento.hora ? `às ${e.agendamento.hora}` : ''} — {e.agendamento.unidade} {e.agendamento.senha ? `(protocolo ${e.agendamento.senha})` : ''}
                      </Text>
                    ) : (
                      <Text size="sm">Aguardando data pela unidade</Text>
                    )}
                    {/* Orientações para coleta de cada exame agendado (TR 1.2.41.10.3). */}
                    {e.preparo && (
                      <Alert color="yellow" variant="light" p="xs" mt={4} title="Orientações para a coleta">
                        <Text size="xs" style={{ whiteSpace: 'pre-line' }}>
                          {e.preparo}
                        </Text>
                      </Alert>
                    )}
                  </Cartao>
                ))}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="realizados" pt="sm">
              <Stack gap={6}>
                {!dados.realizados.length && <Estado vazio />}
                {dados.realizados.map((e: any) => (
                  <Cartao key={e.id} cor="teal">
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={600} size="sm">
                        {e.exame}
                      </Text>
                      <Etiqueta valor={e.situacao} />
                    </Group>
                    <Text size="xs" c="dimmed" mb={4}>
                      Pedido {e.numero} de {fmtData(e.data)} · {e.profissional}
                    </Text>
                    <ResultadoExame item={e} />
                  </Cartao>
                ))}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="pedidos" pt="sm">
              <Stack gap={6}>
                {!dados.pedidos.length && <Estado vazio />}
                {dados.pedidos.map((p: any) => (
                  <Cartao key={p.id}>
                    <Group justify="space-between">
                      <Text fw={600} size="sm">
                        Pedido {p.numero}
                      </Text>
                      <Etiqueta valor={p.situacao} />
                    </Group>
                    <Text size="xs" c="dimmed">
                      {fmtData(p.data)} · {p.profissional} · {p.unidade}
                    </Text>
                    {p.itens.map((i: any) => (
                      <Group key={i.id} justify="space-between" mt={2}>
                        <Text size="sm">{i.exame}</Text>
                        <Etiqueta valor={i.situacao} />
                      </Group>
                    ))}
                  </Cartao>
                ))}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        )}
      </Estado>
    </Stack>
  );
}

// ---------------------------------------------------------------- histórico de atendimentos

const CLASSES: Record<string, { rotulo: string; cor: string; icone: React.ReactNode }> = {
  MEDICO: { rotulo: 'Médico', cor: 'blue', icone: <IconStethoscope size={16} /> },
  ODONTOLOGICO: { rotulo: 'Odontológico', cor: 'cyan', icone: <IconMedicineSyrup size={16} /> },
  ENFERMAGEM: { rotulo: 'Enfermagem', cor: 'grape', icone: <IconFlask size={16} /> },
};

export function Historico() {
  const { pessoa } = useCidadao();
  const navegar = useNavigate();
  const [classe, setClasse] = useState('TODOS');
  const { dados, erro, carregando } = useDados<any[]>(pessoa ? `/api/cidadao/atendimentos?pessoaId=${pessoa.id}` : null, [pessoa?.id]);
  const lista = (dados ?? []).filter((a) => classe === 'TODOS' || a.classe === classe);
  return (
    <Stack gap="md">
      <Title order={3}>Histórico de atendimentos</Title>
      <SegmentedControl value={classe} onChange={setClasse} fullWidth size="xs" data={[{ value: 'TODOS', label: 'Todos' }, { value: 'MEDICO', label: 'Médicos' }, { value: 'ODONTOLOGICO', label: 'Odonto' }, { value: 'ENFERMAGEM', label: 'Enfermagem' }]} />
      <Estado erro={erro} carregando={carregando} vazio={!lista.length}>
        <Stack gap={6}>
          {lista.map((a) => (
            <Cartao key={a.id} cor={CLASSES[a.classe]?.cor} onClick={() => navegar(`/cidadao/historico/${a.id}`)}>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600} size="sm">
                  {a.especialidade ?? CLASSES[a.classe]?.rotulo}
                </Text>
                <Badge variant="light" color={CLASSES[a.classe]?.cor} leftSection={CLASSES[a.classe]?.icone}>
                  {CLASSES[a.classe]?.rotulo}
                </Badge>
              </Group>
              <Text size="xs">
                {fmtDataHora(a.data_hora)} · {a.unidade}
              </Text>
              <Text size="xs" c="dimmed">
                {a.profissional}
                {a.cid_codigo ? ` · CID ${a.cid_codigo}` : ''}
              </Text>
            </Cartao>
          ))}
        </Stack>
      </Estado>
    </Stack>
  );
}

const Linha = ({ r, v }: { r: string; v: any }) =>
  v === null || v === undefined || v === '' ? null : (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed">
        {r}
      </Text>
      <Text size="sm" ta="right">
        {String(v)}
      </Text>
    </Group>
  );

// Odontograma visual (TR 1.2.41.12.5): arcadas permanentes no padrão FDI.
const ARCADAS = [
  [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
];
const COR_DENTE: Record<string, string> = { CARIADO: 'red', CARIE: 'red', RESTAURADO: 'blue', RESTAURACAO: 'blue', AUSENTE: 'gray', EXTRAIDO: 'gray', EXTRACAO: 'orange', COROA: 'yellow', PROTESE: 'grape', SELANTE: 'teal', HIGIDO: 'green' };
function normalizarOdontograma(o: any): Record<string, any> {
  if (!o) return {};
  if (Array.isArray(o)) return Object.fromEntries(o.map((d) => [String(d.dente ?? d.numero), d]));
  if (o.dentes) return normalizarOdontograma(o.dentes);
  return o;
}
export function Odontograma({ dados }: { dados: any }) {
  const dentes = normalizarOdontograma(dados);
  const situacao = (d: any) => String(d?.situacao ?? d?.condicao ?? d?.estado ?? '').toUpperCase();
  return (
    <Stack gap={4}>
      {ARCADAS.map((arcada, i) => (
        <Group key={i} gap={2} justify="center" wrap="nowrap">
          {arcada.map((n) => {
            const d = dentes[String(n)];
            const cor = d ? (COR_DENTE[situacao(d)] ?? 'orange') : null;
            return (
              <Tooltip key={n} label={d ? `${n}: ${situacao(d).toLowerCase()}${d.faces ? ` (faces ${[].concat(d.faces).join(', ')})` : ''}` : `${n}: sem registro`}>
                <Stack gap={0} align="center" style={{ width: 19 }}>
                  {i === 0 && <Text size="9px" c="dimmed">{n}</Text>}
                  <div style={{ width: 17, height: 22, borderRadius: i === 0 ? '6px 6px 9px 9px' : '9px 9px 6px 6px', border: '1px solid var(--mantine-color-gray-5)', background: cor ? `var(--mantine-color-${cor}-4)` : 'white' }} />
                  {i === 1 && <Text size="9px" c="dimmed">{n}</Text>}
                </Stack>
              </Tooltip>
            );
          })}
        </Group>
      ))}
      <Stack gap={0} mt={4}>
        {Object.entries(dentes).map(([n, d]) => (
          <Text key={n} size="xs">
            Dente {n}: {situacao(d).toLowerCase()}
            {(d as any).faces ? ` — faces ${[].concat((d as any).faces).join(', ')}` : ''}
          </Text>
        ))}
      </Stack>
    </Stack>
  );
}

export function DetalheAtendimento() {
  const { id } = useParams();
  const { pessoa } = useCidadao();
  const { dados: a, erro, carregando } = useDados<any>(pessoa ? `/api/cidadao/atendimentos/${id}?pessoaId=${pessoa.id}` : null, [id, pessoa?.id]);
  const t = a?.triagem;
  return (
    <Estado erro={erro} carregando={carregando}>
      {a && (
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={4}>{a.especialidade ?? CLASSES[a.classe]?.rotulo}</Title>
            <Badge color={CLASSES[a.classe]?.cor}>{CLASSES[a.classe]?.rotulo}</Badge>
          </Group>
          <Cartao>
            <Linha r="Data" v={fmtDataHora(a.data_hora)} />
            <Linha r="Unidade" v={a.unidade} />
            <Linha r="Profissional" v={a.profissional} />
            <Linha r="Especialidade" v={a.especialidade} />
            <Linha r="Registro do profissional" v={a.registro_profissional} />
            <Linha r="CID" v={a.cid_codigo ? `${a.cid_codigo} - ${a.cid}` : null} />
            <Linha r="Prontuário" v={a.prontuario} />
          </Cartao>
          {(t || a.triagem_profissional) && (
            <Secao titulo="Triagem" icone={<IconStethoscope size={16} />}>
              <Cartao>
                <Linha r="Profissional" v={t?.profissional ?? a.triagem_profissional} />
                <Linha r="Especialidade" v={t?.especialidade ?? a.triagem_especialidade} />
                <Linha r="Registro do profissional" v={t?.registro_profissional ?? a.triagem_registro} />
                {t && (
                  <SimpleGrid cols={2} spacing={4} mt={4}>
                    <Linha r="Altura (cm)" v={t.altura} />
                    <Linha r="Peso (kg)" v={t.peso} />
                    <Linha r="Cintura (cm)" v={t.cintura} />
                    <Linha r="Abdômen (cm)" v={t.abdomen} />
                    <Linha r="Quadril (cm)" v={t.quadril} />
                    <Linha r="Perímetro encefálico" v={t.perimetro_cefalico} />
                    <Linha r="PA sistólica" v={t.pa_sistolica} />
                    <Linha r="PA diastólica" v={t.pa_diastolica} />
                    <Linha r="Temperatura (°C)" v={t.temperatura} />
                    <Linha r="Freq. cardíaca" v={t.frequencia_cardiaca} />
                    <Linha r="Freq. respiratória" v={t.frequencia_respiratoria} />
                    <Linha r="Saturação O₂ (%)" v={t.saturacao} />
                    <Linha r="Glicemia (mg/dL)" v={t.glicemia} />
                  </SimpleGrid>
                )}
              </Cartao>
            </Secao>
          )}
          {a.odontograma && (
            <Secao titulo="Odontograma" icone={<IconMedicineSyrup size={16} />}>
              <Cartao>
                <Odontograma dados={a.odontograma} />
              </Cartao>
            </Secao>
          )}
          <Secao titulo="Procedimentos efetuados" icone={<IconStethoscope size={16} />}>
            {!a.procedimentos.length && <Estado vazio />}
            {a.procedimentos.map((p: any, i: number) => (
              <Text key={i} size="sm">
                {p.codigo} - {p.nome}
                {p.quantidade > 1 ? ` (${p.quantidade})` : ''}
              </Text>
            ))}
          </Secao>
          <Secao titulo="Procedimentos e exames solicitados" icone={<IconFlask size={16} />}>
            {!a.examesSolicitados.length && !a.encaminhamentos.length && <Estado vazio />}
            {a.examesSolicitados.map((e: any, i: number) => (
              <Group key={i} justify="space-between">
                <Text size="sm">{e.nome}</Text>
                <Etiqueta valor={e.situacao} />
              </Group>
            ))}
            {a.encaminhamentos.map((e: any, i: number) => (
              <Text key={`e${i}`} size="sm">
                Encaminhamento: {e.especialidade} ({e.situacao?.toLowerCase()})
              </Text>
            ))}
          </Secao>
          <Secao titulo="Prescrições e recomendações" icone={<IconPill size={16} />}>
            {!a.prescricoes.length && <Estado vazio />}
            {a.prescricoes.map((p: any, i: number) => (
              <Stack key={i} gap={0}>
                <Text size="sm" fw={600}>
                  {p.medicamento}
                </Text>
                <Text size="xs">
                  {p.posologia}
                  {p.uso_continuo ? ' · uso contínuo' : p.duracao_dias ? ` · por ${p.duracao_dias} dias` : ''}
                </Text>
              </Stack>
            ))}
            {a.prescricoes[0]?.orientacoes && (
              <>
                <Divider />
                <Text size="sm">Recomendações: {a.prescricoes[0].orientacoes}</Text>
              </>
            )}
          </Secao>
          {(a.subjetivo || a.avaliacao || a.plano) && (
            <Secao titulo="Registro clínico">
              <Cartao>
                <Linha r="Queixa" v={a.subjetivo} />
                <Linha r="Avaliação" v={a.avaliacao} />
                <Linha r="Plano" v={a.plano} />
              </Cartao>
            </Secao>
          )}
        </Stack>
      )}
    </Estado>
  );
}
