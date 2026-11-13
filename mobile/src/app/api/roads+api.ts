import { isPoint } from '../../location/geo';

export async function POST(request: Request) {
  const point: unknown = await request.json().catch(() => null);
  if (!isPoint(point)) return Response.json({}, { status: 400 });

  const query = `[out:json][timeout:5];way["highway"~"^(primary|secondary|tertiary|residential|living_street|pedestrian|unclassified|service|footway|path|steps)$"](around:450,${point.latitude},${point.longitude});out geom;`;
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return Response.json({}, { status: 502 });
    const data = await response.json() as { elements: { geometry?: { lat: number; lon: number }[] }[] };
    const roads = data.elements.flatMap(({ geometry }) => {
      const points = geometry?.map(({ lat, lon }) => ({ latitude: lat, longitude: lon }));
      return points && points.length >= 2 && points.every(isPoint) ? [points] : [];
    });
    return Response.json({ roads });
  } catch {
    return Response.json({}, { status: 502 });
  }
}
