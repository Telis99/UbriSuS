// Telas genéricas de cadastro (/e/:entidade) e administração da plataforma.
import { Consulta } from '@/genericos/Consulta';
import { Formulario } from '@/genericos/Formulario';
import { useMeta } from '@/genericos/useMeta';
import { useTituloJanela } from '@/shell/Janelas';
import { registrarTela } from './registro';

function TelaConsulta({ entidade }: { entidade: string }) {
  const { meta } = useMeta(entidade);
  useTituloJanela(meta?.titulo);
  return <Consulta entidade={entidade} />;
}

registrarTela({
  id: 'entidade-consulta',
  titulo: 'Consulta',
  padrao: '/e/:entidade',
  render: ({ params }) => <TelaConsulta entidade={params.entidade} />,
});
registrarTela({
  id: 'entidade-novo',
  titulo: 'Novo',
  padrao: '/e/:entidade/novo',
  render: ({ params, query }) => <Formulario entidade={params.entidade} iniciais={Object.fromEntries(query.entries())} />,
});
registrarTela({
  id: 'entidade-registro',
  titulo: 'Registro',
  padrao: '/e/:entidade/:id',
  render: ({ params }) => <Formulario entidade={params.entidade} id={Number(params.id)} />,
});
