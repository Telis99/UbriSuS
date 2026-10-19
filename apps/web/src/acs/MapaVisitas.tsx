// Mapa interativo dos locais de visita dos agentes comunitários, com imagens de satélite e mapa de
// calor para identificar as áreas de cobertura da atenção básica (TR 1.2.49.2.1).
import { useMemo, useState } from 'react';
import { Group, SegmentedControl, Stack, Switch, Text } from '@mantine/core';
import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export interface PontoVisita {
  id: number | string;
  latitude: number;
  longitude: number;
  data_hora?: string;
  desfecho?: string;
  pessoa?: string | null;
  familia?: string | null;
  profissional?: string | null;
}

const CAMADAS = {
  satelite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', atribuicao: 'Imagens &copy; Esri' },
  mapa: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', atribuicao: '&copy; OpenStreetMap' },
};

/** Escala de calor (azul → verde → amarelo → vermelho) conforme a densidade de visitas na célula. */
function corCalor(t: number) {
  const paradas: [number, [number, number, number]][] = [
    [0, [49, 130, 206]],
    [0.35, [56, 178, 120]],
    [0.65, [250, 204, 21]],
    [1, [220, 38, 38]],
  ];
  for (let i = 1; i < paradas.length; i++) {
    if (t <= paradas[i][0]) {
      const [t0, c0] = paradas[i - 1];
      const [t1, c1] = paradas[i];
      const k = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    }
  }
  return 'rgb(220,38,38)';
}

export function MapaVisitas({ pontos, altura = 420 }: { pontos: PontoVisita[]; altura?: number | string }) {
  const [camada, setCamada] = useState<'satelite' | 'mapa'>('satelite');
  const [calor, setCalor] = useState(true);
  const [marcadores, setMarcadores] = useState(true);
  const validos = pontos.filter((p) => p.latitude != null && p.longitude != null && !Number.isNaN(Number(p.latitude)));
  // Agregação em células de ~80 m para o mapa de calor.
  const celulas = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; n: number }>();
    for (const p of validos) {
      const k = `${Math.round(Number(p.latitude) / 0.0008)}:${Math.round(Number(p.longitude) / 0.0008)}`;
      const c = m.get(k) ?? { lat: 0, lng: 0, n: 0 };
      c.lat += Number(p.latitude);
      c.lng += Number(p.longitude);
      c.n++;
      m.set(k, c);
    }
    const lista = [...m.values()].map((c) => ({ lat: c.lat / c.n, lng: c.lng / c.n, n: c.n }));
    const max = Math.max(1, ...lista.map((c) => c.n));
    return lista.map((c) => ({ ...c, t: c.n / max }));
  }, [validos]);
  const centro: [number, number] = validos.length
    ? [validos.reduce((s, p) => s + Number(p.latitude), 0) / validos.length, validos.reduce((s, p) => s + Number(p.longitude), 0) / validos.length]
    : [-23.3076, -47.1329];
  return (
    <Stack gap="xs">
      <Group justify="space-between" gap="xs">
        <SegmentedControl size="xs" value={camada} onChange={(v) => setCamada(v as any)} data={[{ value: 'satelite', label: 'Satélite' }, { value: 'mapa', label: 'Mapa' }]} />
        <Group gap="sm">
          <Switch size="xs" label="Calor" checked={calor} onChange={(e) => setCalor(e.currentTarget.checked)} />
          <Switch size="xs" label="Visitas" checked={marcadores} onChange={(e) => setMarcadores(e.currentTarget.checked)} />
        </Group>
      </Group>
      <div style={{ height: altura, borderRadius: 10, overflow: 'hidden' }}>
        <MapContainer key={`${centro[0].toFixed(3)}:${centro[1].toFixed(3)}`} center={centro} zoom={15} style={{ height: '100%' }}>
          <TileLayer key={camada} url={CAMADAS[camada].url} attribution={CAMADAS[camada].atribuicao} maxZoom={19} />
          {calor &&
            celulas.map((c, i) => (
              <Circle key={`c${i}`} center={[c.lat, c.lng]} radius={70 + 90 * c.t} pathOptions={{ stroke: false, fillColor: corCalor(c.t), fillOpacity: 0.25 + 0.35 * c.t }} />
            ))}
          {marcadores &&
            validos.map((p) => (
              <CircleMarker key={p.id} center={[Number(p.latitude), Number(p.longitude)]} radius={5} pathOptions={{ color: 'white', weight: 1, fillColor: p.desfecho === 'REALIZADA' || !p.desfecho ? '#1c5aa8' : '#f08c00', fillOpacity: 0.95 }}>
                <Popup>
                  <b>{p.familia ?? 'Visita'}</b>
                  {p.pessoa && <div>{p.pessoa}</div>}
                  {p.data_hora && <div>{new Date(p.data_hora).toLocaleString('pt-BR')}</div>}
                  {p.desfecho && <div>{p.desfecho === 'REALIZADA' ? 'Visita realizada' : p.desfecho === 'AUSENTE' ? 'Ausente' : 'Recusada'}</div>}
                  {p.profissional && <div>ACS: {p.profissional}</div>}
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>
      </div>
      <Text size="xs" c="dimmed">
        {validos.length} visita(s) georreferenciada(s). Cores do calor: azul (poucas visitas) a vermelho (maior concentração).
      </Text>
    </Stack>
  );
}
