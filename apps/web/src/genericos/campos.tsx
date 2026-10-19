// Componentes de entrada por tipo de campo, com máscara, validação no navegador,
// limite de caracteres, dica de preenchimento e ditado por voz.
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Button,
  ColorInput,
  FileButton,
  Group,
  Image,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateInput, DateTimePicker, TimeInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCamera, IconExternalLink, IconInfoCircle, IconPaperclip, IconTrash } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { somenteDigitos, validarCep, validarCnpj, validarCns, validarCpf, validarEmail, validarTelefone } from '@compartilhado/validacao';
import { api, urlArquivo } from '@/api';
import { BotaoDitado } from '@/voz/Ditado';
import type { Campo } from '@/tipos';

// Máscaras e exemplos de preenchimento identificam o formato de cada campo (TR 1.1.2.1.25).
export const MASCARAS: Record<string, (d: string) => string> = {
  cpf: (d) => d.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2'),
  cns: (d) => d.slice(0, 15).replace(/(\d{3})(\d)/, '$1 $2').replace(/(\d{3}) (\d{4})(\d)/, '$1 $2 $3').replace(/(\d{4}) (\d{4})(\d)/, '$1 $2 $3'),
  cnpj: (d) =>
    d
      .slice(0, 14)
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/\/(\d{4})(\d)/, '/$1-$2'),
  cep: (d) => d.slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2'),
  telefone: (d) => (d.length > 10 ? d.slice(0, 11).replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3') : d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3')),
};

const PLACEHOLDER: Partial<Record<Campo['tipo'], string>> = {
  cpf: '000.000.000-00',
  cns: '000 0000 0000 0000',
  cnpj: '00.000.000/0000-00',
  cep: '00000-000',
  telefone: '(00) 00000-0000',
  email: 'nome@dominio.com.br',
  data: 'dd/mm/aaaa',
  hora: 'hh:mm',
};

/** Validação no navegador antes do envio (TR 1.1.1.5, 1.1.2.1.19). */
export function validarCampo(c: Campo, v: any): string | null {
  const vazio = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
  if (vazio) return c.obrigatorio && !c.oculto && !c.somenteLeitura ? `${c.rotulo} é obrigatório.` : null;
  switch (c.tipo) {
    case 'cpf':
      return validarCpf(v) ? null : 'CPF inválido.';
    case 'cns':
      return validarCns(v) ? null : 'Cartão Nacional de Saúde inválido.';
    case 'cnpj':
      return validarCnpj(v) ? null : 'CNPJ inválido.';
    case 'cep':
      return validarCep(v) ? null : 'CEP deve ter 8 dígitos.';
    case 'telefone':
      return validarTelefone(v) ? null : 'Informe DDD + número.';
    case 'email':
      return validarEmail(v) ? null : 'E-mail inválido.';
    case 'data':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Data inválida.';
    case 'texto':
    case 'texto_longo':
      return c.max && String(v).length > c.max ? `Máximo de ${c.max} caracteres.` : null;
  }
  return null;
}

function Rotulo({ c }: { c: Campo }) {
  if (!c.ajuda) return <>{c.rotulo}</>;
  return (
    <Group gap={4} wrap="nowrap" component="span">
      {c.rotulo}
      <Tooltip label={c.ajuda} multiline w={280} withArrow>
        <IconInfoCircle size={14} style={{ opacity: 0.6 }} />
      </Tooltip>
    </Group>
  );
}

export interface PropsCampo {
  campo: Campo;
  valor: any;
  aoMudar: (v: any) => void;
  erro?: string | null;
  rotuloRef?: string | null;
  desabilitado?: boolean;
  registro?: Record<string, any>;
}

// Entrada padronizada: a digitação é bloqueada no tamanho máximo do campo, com contador (TR 1.1.2.1.26);
// referências com busca incremental, valores padrão e ditado agilizam o preenchimento (TR 1.1.2.1.30).
export const EntradaCampo = forwardRef<HTMLInputElement, PropsCampo>(function EntradaCampo(
  { campo: c, valor, aoMudar, erro, rotuloRef, desabilitado, registro },
  ref,
) {
  const comum = {
    label: <Rotulo c={c} />,
    required: c.obrigatorio && !c.somenteLeitura,
    error: erro ?? undefined,
    disabled: desabilitado || c.somenteLeitura,
    placeholder: PLACEHOLDER[c.tipo],
    title: c.ajuda,
    'data-campo': c.nome,
  };
  const textoRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  switch (c.tipo) {
    case 'texto':
    case 'email':
      return (
        <TextInput
          {...comum}
          ref={(el) => {
            textoRef.current = el;
            if (typeof ref === 'function') ref(el);
          }}
          value={valor ?? ''}
          maxLength={c.max}
          onChange={(e) => aoMudar(c.maiusculo ? e.currentTarget.value.toUpperCase() : e.currentTarget.value)}
          rightSection={c.tipo === 'texto' && !comum.disabled ? <BotaoDitado tamanho="sm" alvo={() => textoRef.current} /> : undefined}
          description={c.max && c.max > 30 ? `${String(valor ?? '').length}/${c.max}` : undefined}
          inputWrapperOrder={['label', 'input', 'description', 'error']}
        />
      );
    case 'texto_longo':
      return (
        <Textarea
          {...comum}
          ref={(el) => {
            textoRef.current = el;
          }}
          value={valor ?? ''}
          maxLength={c.max}
          autosize
          minRows={3}
          maxRows={14}
          onChange={(e) => aoMudar(e.currentTarget.value)}
          rightSection={!comum.disabled ? <BotaoDitado tamanho="sm" alvo={() => textoRef.current} /> : undefined}
          rightSectionProps={{ style: { alignItems: 'flex-start', paddingTop: 6 } }}
        />
      );
    case 'cpf':
    case 'cns':
    case 'cnpj':
    case 'cep':
    case 'telefone':
      return (
        <TextInput
          {...comum}
          ref={ref}
          inputMode="numeric"
          data-sem-ditado
          value={MASCARAS[c.tipo](somenteDigitos(valor))}
          onChange={(e) => aoMudar(somenteDigitos(e.currentTarget.value) || null)}
        />
      );
    case 'inteiro':
    case 'decimal':
    case 'moeda':
      return (
        <NumberInput
          {...comum}
          value={valor ?? ''}
          onChange={(v) => aoMudar(v === '' ? null : Number(v))}
          decimalSeparator=","
          thousandSeparator="."
          allowDecimal={c.tipo !== 'inteiro'}
          decimalScale={c.tipo === 'moeda' ? 2 : c.casas ?? 4}
          fixedDecimalScale={c.tipo === 'moeda'}
          prefix={c.tipo === 'moeda' ? 'R$ ' : undefined}
          min={c.min}
          max={c.tipo === 'inteiro' && c.max ? c.max : undefined}
          hideControls
        />
      );
    case 'data':
      return (
        <DateInput
          {...comum}
          value={valor ? dayjs(valor).toDate() : null}
          onChange={(d) => aoMudar(d ? dayjs(d).format('YYYY-MM-DD') : null)}
          valueFormat="DD/MM/YYYY"
          clearable
          dateParser={(s) => dayjs(s, ['DD/MM/YYYY', 'DDMMYYYY', 'YYYY-MM-DD'], true).toDate()}
        />
      );
    case 'data_hora':
      return (
        <DateTimePicker
          {...comum}
          value={valor ? new Date(valor) : null}
          onChange={(d) => aoMudar(d ? d.toISOString() : null)}
          valueFormat="DD/MM/YYYY HH:mm"
          clearable
        />
      );
    case 'hora':
      return <TimeInput {...comum} value={valor?.slice(0, 5) ?? ''} onChange={(e) => aoMudar(e.currentTarget.value || null)} />;
    case 'booleano':
      return (
        <Switch
          mt={26}
          label={<Rotulo c={c} />}
          checked={!!valor}
          disabled={comum.disabled}
          onChange={(e) => aoMudar(e.currentTarget.checked)}
          title={c.ajuda}
        />
      );
    case 'opcao':
      return (
        <Select
          {...comum}
          data={(c.opcoes ?? []).map(([v, r]) => ({ value: v, label: r }))}
          value={valor ?? null}
          onChange={(v) => aoMudar(v)}
          searchable
          clearable={!c.obrigatorio}
          nothingFoundMessage="Nenhuma opção"
          comboboxProps={{ withinPortal: true }}
        />
      );
    case 'multi_opcao':
      return (
        <MultiSelect
          {...comum}
          data={(c.opcoes ?? []).map(([v, r]) => ({ value: v, label: r }))}
          value={valor ?? []}
          onChange={(v) => aoMudar(v)}
          searchable
          clearable
        />
      );
    case 'cor':
      return <ColorInput {...comum} value={valor ?? ''} onChange={(v) => aoMudar(v || null)} format="hex" />;
    case 'ref':
      return <CampoRef campo={c} valor={valor} rotuloInicial={rotuloRef} aoMudar={aoMudar} erro={erro} desabilitado={comum.disabled} registro={registro} />;
    case 'arquivo':
      return <CampoArquivo campo={c} valor={valor} aoMudar={aoMudar} desabilitado={comum.disabled} />;
    default:
      return null;
  }
});

/** Seleção de registro relacionado com pesquisa por palavra-chave (TR 1.1.1.58, 1.1.2.1.16). */
export function CampoRef({
  campo: c,
  valor,
  rotuloInicial,
  aoMudar,
  erro,
  desabilitado,
  filtro,
  registro,
}: {
  campo: Campo;
  valor: any;
  rotuloInicial?: string | null;
  aoMudar: (v: any, rotulo?: string) => void;
  erro?: string | null;
  desabilitado?: boolean;
  filtro?: Record<string, unknown>;
  registro?: Record<string, any>;
}) {
  const [busca, setBusca] = useState('');
  const [deb] = useDebouncedValue(busca, 250);
  const [opcoes, setOpcoes] = useState<{ id: number; rotulo: string }[]>([]);
  const [rotulo, setRotulo] = useState<string | null>(rotuloInicial ?? null);
  useEffect(() => setRotulo(rotuloInicial ?? null), [rotuloInicial]);

  // Filtro dependente: logradouros e bairros do município selecionado no mesmo formulário.
  const filtroEfetivo = useMemo(() => {
    const f: Record<string, unknown> = { ...(c.refFiltro ?? {}), ...(filtro ?? {}) };
    if ((c.ref === 'bairro' || c.ref === 'logradouro' || c.ref === 'localidade') && registro?.municipio_id) f.municipio_id = registro.municipio_id;
    return f;
  }, [c.ref, c.refFiltro, filtro, registro?.municipio_id]);

  useEffect(() => {
    if (desabilitado) return;
    let ativo = true;
    api
      .get<{ id: number; rotulo: string }[]>(`/api/e/${c.ref}/opcoes`, { q: deb, filtro: Object.keys(filtroEfetivo).length ? filtroEfetivo : undefined })
      .then((r) => ativo && setOpcoes(r))
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [deb, c.ref, filtroEfetivo, desabilitado]);

  const dados = useMemo(() => {
    const lista = opcoes.map((o) => ({ value: String(o.id), label: o.rotulo || `#${o.id}` }));
    if (valor && !lista.some((o) => o.value === String(valor))) lista.unshift({ value: String(valor), label: rotulo ?? `#${valor}` });
    return lista;
  }, [opcoes, valor, rotulo]);

  return (
    <Select
      label={<Rotulo c={c} />}
      required={c.obrigatorio && !c.somenteLeitura}
      error={erro ?? undefined}
      disabled={desabilitado}
      data={dados}
      value={valor ? String(valor) : null}
      searchable
      clearable
      filter={({ options }) => options}
      searchValue={busca}
      onSearchChange={setBusca}
      onChange={(v, opt) => {
        setRotulo(opt?.label ?? null);
        aoMudar(v ? Number(v) : null, opt?.label);
      }}
      nothingFoundMessage="Digite para pesquisar"
      comboboxProps={{ withinPortal: true }}
      data-campo={c.nome}
      rightSectionPointerEvents={valor ? 'all' : 'none'}
      rightSection={
        valor ? (
          <Tooltip label="Abrir cadastro em nova janela">
            <ActionIcon variant="subtle" size="sm" onClick={() => window.open(`/e/${c.ref}/${valor}?janela=1`, '_blank', 'popup,width=1100,height=760')}>
              <IconExternalLink size={14} />
            </ActionIcon>
          </Tooltip>
        ) : undefined
      }
    />
  );
}

/** Anexo de arquivo; para fotos permite captura direta pela câmera do navegador (TR 1.2.6.26). */
export function CampoArquivo({ campo: c, valor, aoMudar, desabilitado }: { campo: Campo; valor: any; aoMudar: (v: any) => void; desabilitado?: boolean }) {
  const [enviando, setEnviando] = useState(false);
  const [camera, setCamera] = useState(false);
  const foto = /foto|imagem|carimbo|assinatura|brasao/.test(c.nome);

  async function enviar(arq: File | Blob | null, nome?: string) {
    if (!arq) return;
    setEnviando(true);
    try {
      const r = await api.enviarArquivo(arq, nome);
      aoMudar(r.id);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        <Rotulo c={c} />
      </Text>
      {valor && foto && <Image src={urlArquivo(valor)} h={120} w="auto" fit="contain" radius="sm" alt={c.rotulo} />}
      <Group gap="xs">
        {valor && !foto && (
          <Anchor href={urlArquivo(valor)} target="_blank" size="sm">
            Visualizar arquivo
          </Anchor>
        )}
        {!desabilitado && (
          <>
            <FileButton onChange={(f) => void enviar(f)} accept={foto ? 'image/png,image/jpeg,image/webp' : 'application/pdf,image/png,image/jpeg'}>
              {(props) => (
                <Button {...props} size="xs" variant="default" leftSection={<IconPaperclip size={14} />} loading={enviando}>
                  {valor ? 'Substituir' : 'Anexar'}
                </Button>
              )}
            </FileButton>
            {foto && (
              <Button size="xs" variant="default" leftSection={<IconCamera size={14} />} onClick={() => setCamera(true)}>
                Câmera
              </Button>
            )}
            {valor && (
              <ActionIcon variant="subtle" color="red" onClick={() => aoMudar(null)} aria-label="Remover">
                <IconTrash size={14} />
              </ActionIcon>
            )}
          </>
        )}
      </Group>
      <CapturaCamera
        aberto={camera}
        aoFechar={() => setCamera(false)}
        aoCapturar={(b) => {
          setCamera(false);
          void enviar(b, 'foto.jpg');
        }}
      />
    </Stack>
  );
}

export function CapturaCamera({ aberto, aoFechar, aoCapturar }: { aberto: boolean; aoFechar: () => void; aoCapturar: (b: Blob) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!aberto) return;
    let fluxo: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 640, height: 480 } })
      .then((s) => {
        fluxo = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch((e) => setErro('Não foi possível acessar a câmera: ' + e.message));
    return () => fluxo?.getTracks().forEach((t) => t.stop());
  }, [aberto]);

  function capturar() {
    const v = video.current;
    if (!v) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    canvas.toBlob((b) => b && aoCapturar(b), 'image/jpeg', 0.9);
  }

  return (
    <Modal opened={aberto} onClose={aoFechar} title="Capturar foto" size="lg">
      {erro ? <Text c="red">{erro}</Text> : <video ref={video} autoPlay playsInline style={{ width: '100%', borderRadius: 8, background: '#000' }} />}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={aoFechar}>
          Cancelar
        </Button>
        <Button leftSection={<IconCamera size={16} />} onClick={capturar} disabled={!!erro}>
          Capturar
        </Button>
      </Group>
    </Modal>
  );
}
