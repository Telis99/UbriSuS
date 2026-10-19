// Consulta ao CADSUS pela Rede Nacional de Dados em Saúde (RNDS, FHIR R4), com
// autenticação mútua pelo certificado ICP-Brasil do estabelecimento (TR 1.2.6.6).
// A ativação depende do credenciamento do município na RNDS (TR 1.1.1.41.1).
import https from 'node:https';
import { consultarUm } from '../../db/pool.js';
import { decifrar } from '../../servicos/cripto.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';

interface ConfigRnds {
  ativo: boolean;
  urlAutenticacao: string;
  urlServicos: string;
  certificadoId: number;
  cpfResponsavel: string;
}

let tokenCache: { token: string; expira: number } | null = null;

function requisitar(url: string, opcoes: https.RequestOptions & { corpo?: string }): Promise<{ status: number; corpo: string }> {
  const { corpo, ...opts } = opcoes;
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(url), { ...opts, timeout: 15_000 });
    req.on('response', (res: NodeJS.ReadableStream & { statusCode?: number }) => {
      const partes: Buffer[] = [];
      res.on('data', (d: Buffer) => partes.push(d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado na comunicação com a RNDS.')));
    if (corpo) req.write(corpo);
    req.end();
  });
}

async function obterConfig(): Promise<ConfigRnds> {
  const r = await consultarUm(`select valor from sis.parametro where chave = 'integracao.rnds'`);
  const cfg = r?.valor as ConfigRnds | undefined;
  if (!cfg?.ativo) {
    throw new ErroHttp(503, 'Integração com o CADSUS/RNDS não ativada. Configure o certificado do estabelecimento e as URLs em Parâmetros > Integrações.');
  }
  return cfg;
}

async function certificado(id: number) {
  const c = await consultarUm(`select conteudo_cifrado from seg.certificado where id = $1 and ativo`, [id]);
  if (!c) throw new ErroHttp(503, 'Certificado digital da integração RNDS não encontrado.');
  const pacote = JSON.parse(decifrar(c.conteudo_cifrado).toString('utf8')) as { pfx: string; senha: string };
  return { pfx: Buffer.from(pacote.pfx, 'base64'), passphrase: pacote.senha };
}

async function token(cfg: ConfigRnds) {
  if (tokenCache && tokenCache.expira > Date.now()) return tokenCache.token;
  const cert = await certificado(cfg.certificadoId);
  const r = await requisitar(cfg.urlAutenticacao, { method: 'GET', ...cert });
  if (r.status !== 200) throw new ErroHttp(502, `Falha na autenticação RNDS (HTTP ${r.status}).`);
  const j = JSON.parse(r.corpo);
  tokenCache = { token: j.access_token, expira: Date.now() + Math.max(60, (j.expires_in ?? 1800) - 60) * 1000 };
  return tokenCache.token;
}

const NS = 'http://rnds.saude.gov.br/fhir/r4/NamingSystem';

/** Converte o recurso FHIR Patient para os campos do cadastro de pacientes. */
export function pacienteFhirParaCadastro(p: any) {
  const ident = (sistema: string) => p.identifier?.find((i: any) => String(i.system).endsWith(sistema))?.value;
  const ext = (sufixo: string) => p.extension?.find((e: any) => String(e.url).endsWith(sufixo));
  const raca = ext('BRRacaCorEtnia')?.extension?.find((e: any) => e.url === 'race')?.valueCodeableConcept?.coding?.[0]?.code;
  const mae = p.contact?.find((c: any) => c.relationship?.some((r: any) => r.coding?.some((x: any) => /mother|mae|mãe/i.test(x.code ?? x.display ?? ''))))?.name?.text;
  const end = p.address?.[0];
  const tel = p.telecom?.find((t: any) => t.system === 'phone')?.value;
  return {
    nome: p.name?.[0]?.text ?? [...(p.name?.[0]?.given ?? []), p.name?.[0]?.family].filter(Boolean).join(' '),
    data_nascimento: p.birthDate,
    sexo: p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : 'I',
    cpf: ident('/cpf'),
    cns: ident('/cns'),
    raca_cor: raca ? String(raca).padStart(2, '0') : undefined,
    nome_mae: mae ?? ext('BRNomeMae')?.valueString,
    celular: tel ? String(tel).replace(/\D/g, '').slice(-11) : undefined,
    cep: end?.postalCode?.replace(/\D/g, ''),
    numero: end?.line?.[1],
    situacao: p.deceasedBoolean || p.deceasedDateTime ? 'FALECIDO' : 'ATIVO',
    data_obito: p.deceasedDateTime?.slice(0, 10),
  };
}

export async function consultarCadsus(chave: { cpf?: string; cns?: string }, u: Usuario) {
  const cfg = await obterConfig();
  const tk = await token(cfg);
  const identificador = chave.cpf ? `${NS}/cpf|${chave.cpf}` : `${NS}/cns|${chave.cns}`;
  const r = await requisitar(`${cfg.urlServicos.replace(/\/$/, '')}/api/fhir/r4/Patient?identifier=${encodeURIComponent(identificador)}`, {
    method: 'GET',
    headers: { 'X-Authorization-Server': `Bearer ${tk}`, Authorization: cfg.cpfResponsavel || u.login, Accept: 'application/fhir+json' },
  });
  if (r.status === 404) return { encontrado: false };
  if (r.status !== 200) throw new ErroHttp(502, `CADSUS respondeu HTTP ${r.status}.`);
  const bundle = JSON.parse(r.corpo);
  const recurso = bundle.entry?.[0]?.resource ?? (bundle.resourceType === 'Patient' ? bundle : null);
  if (!recurso) return { encontrado: false };
  return { encontrado: true, dados: pacienteFhirParaCadastro(recurso) };
}
