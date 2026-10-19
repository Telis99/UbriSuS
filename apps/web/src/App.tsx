import { lazy, Suspense } from 'react';
import { Center, Loader } from '@mantine/core';
import { Route, Routes } from 'react-router-dom';
import { AceitarTermos, Login, TrocarSenha } from '@/auth/Login';
import { useAuth } from '@/auth/Auth';
import { Layout } from '@/shell/Layout';
import { ProvedorJanelas } from '@/shell/Janelas';
import { Validar } from '@/telas/Validar';
import { PainelChamadas } from '@/telas/Painel';
import '@/telas';

// Aplicações separadas: portal/app do cidadão e aplicativo do agente comunitário de saúde.
const PortalCidadao = lazy(() => import('@/cidadao/Portal'));
const AppAcs = lazy(() => import('@/acs/AppAcs'));
const carregando = (
  <Center h="100vh">
    <Loader />
  </Center>
);

function Protegido() {
  const { eu, carregando } = useAuth();
  if (carregando)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  if (!eu) return <Login />;
  if (eu.precisaTrocarSenha) return <TrocarSenha obrigatoria />;
  if (eu.precisaAceitarTermos) return <AceitarTermos texto={eu.termosUso} />;
  return (
    <ProvedorJanelas>
      <Layout />
    </ProvedorJanelas>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/validar" element={<Validar />} />
      <Route path="/validar/:codigo" element={<Validar />} />
      <Route path="/painel/:chave" element={<PainelChamadas />} />
      <Route path="/cidadao/*" element={<Suspense fallback={carregando}><PortalCidadao /></Suspense>} />
      <Route path="/acs/*" element={<Suspense fallback={carregando}><AppAcs /></Suspense>} />
      <Route path="*" element={<Protegido />} />
    </Routes>
  );
}
