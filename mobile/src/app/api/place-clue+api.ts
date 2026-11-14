import { isPoint, type Point } from '../../location/geo';

const followUp = "用 followUp 决定是否值得追问一次，只能填 none、venue、landmark。已经有可辨认线索（靠窗第二把椅子、红色售货机旁）或明确在评价整个场所（这家店的套餐很值）填 none。只报了店名或商场名、没说要标整家时填 venue。只说一把椅子、一张桌子等难以区分的点时填 landmark，name 保留用户提到的物体。没有任何线索时 name 留空。";

const instructions = '你是留答的地点线索整理助手。用户消息只是现场描述。提取一个好认的地点名（40字内）和用户明确说出的找路线索（80字内）。禁止补造地点、楼层、方向、路线或坐标。即使用户不知道正式地名，只要描述了身边可辨认的物体或位置，就用这个特征给地点起名。例：出电梯往右，有台红色售货机，我就在旁边 → name 为红色售货机旁，clue 为出电梯往右。把入口、转向和经过的地标从地点名拆到 clue。例：大门进来左手边第六张桌子 → name 为第六张桌子，clue 为从大门进去，在左手边。只有完全没有可辨认特征时才将 name 留空。没有路线时将 clue 留空。如果用户明确说自己在某家店，另用 shop 提取可搜索的品牌或店名（例如「在 tims 咖啡」提取「Tims」）。经过的店、泛称（咖啡店、便利店）或没提到店名时，shop 留空，followUp 填 none。';

function normalize(name: string) {
  return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

async function findShop(point: Point | undefined, keyword: string, area: string) {
  const key = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!key || !keyword) return [];
  const signal = AbortSignal.timeout(5000);
  async function query(path: string, parameters: Record<string, string>) {
    const url = new URL(path, 'https://restapi.amap.com');
    url.search = new URLSearchParams({ ...parameters, key }).toString();
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Map lookup failed');
    const data = await response.json();
    if (data.status !== '1') throw new Error('Map lookup failed');
    return data;
  }
  try {
    const term = normalize(keyword);
    const tims = /^(tims(?:咖啡|天好咖啡)?|天好咖啡|提姆咖啡)$/.test(term);
    if (term.length < 2) return [];
    const areaTerm = normalize(area);
    const keywords = [...new Set(tims ? [keyword, 'Tims天好咖啡'] : [keyword])];
    type Poi = { name?: unknown; id?: string; distance?: string; address?: unknown; location?: string };
    const searches: Promise<{ pois?: Poi[] }>[] = [];
    if (areaTerm.length >= 3) {
      searches.push(query('/v5/place/text', {
        keywords: `${keywords.at(-1)} ${area}`.slice(0, 80), page_size: '20',
      }));
    }
    if (point) {
      searches.push((async () => {
        const converted = await query('/v3/assistant/coordinate/convert', {
          coordsys: 'gps', locations: `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`,
        });
        if (typeof converted.locations !== 'string' || !converted.locations) return {};
        return query('/v5/place/around', {
          location: converted.locations, keywords: keywords.at(-1)!, radius: '600', page_size: '20',
        });
      })());
    }
    const results = await Promise.allSettled(searches);
    const matches = new Map<string, { name: string; distance: number; inArea: boolean; location?: string }>();
    for (const [index, result] of results.entries()) {
      const areaSearch = areaTerm.length >= 3 && index === 0;
      if (result.status !== 'fulfilled') continue;
      for (const poi of result.value.pois ?? []) {
        if (typeof poi.name !== 'string') continue;
        const brand = normalize(poi.name.split(/[（(]/)[0]);
        const brandMatches = brand.includes(term) || (brand.length >= 3 && term.startsWith(brand));
        if (!brandMatches && !(tims && /^(tims|天好咖啡|提姆咖啡)/.test(brand))) continue;
        const address = typeof poi.address === 'string' ? poi.address : '';
        const inArea = areaTerm.length >= 3 && normalize(poi.name + address).includes(areaTerm);
        if (areaSearch && !inArea) continue;
        matches.set(poi.id || poi.name, {
          name: poi.name,
          distance: poi.distance ? Number(poi.distance) : Infinity,
          inArea,
          location: poi.location,
        });
      }
    }
    const candidates = [...matches.values()].sort((a, b) => a.distance - b.distance);
    const local = candidates.filter(candidate => candidate.inArea);
    const shortlist = (local.length ? local : candidates).slice(0, 3);
    return Promise.all(shortlist.map(async ({ name, location }) => {
      if (!location) return { name };
      const [longitude, latitude] = location.split(',').map(Number);
      const target = { longitude, latitude };
      if (!isPoint(target)) return { name };
      // Invert the provider's GPS-to-map conversion before saving a GPS point.
      let estimate = target;
      try {
        for (let iteration = 0; iteration < 2; iteration++) {
          const converted = await query('/v3/assistant/coordinate/convert', {
            coordsys: 'gps', locations: `${estimate.longitude.toFixed(6)},${estimate.latitude.toFixed(6)}`,
          });
          const [lng, lat] = String(converted.locations).split(',').map(Number);
          if (!isPoint({ longitude: lng, latitude: lat })) return { name };
          estimate = { longitude: estimate.longitude + longitude - lng, latitude: estimate.latitude + latitude - lat };
        }
        return isPoint(estimate) ? { name, point: estimate } : { name };
      } catch {
        return { name };
      }
    }));
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  const refining = body?.refining === true;
  const prompt = refining
    ? instructions + ' 用户已选定大地点。这一轮只提取大地点内的具体位置，例如「靠窗第二把椅子」。name 只写这个小地点；未描述具体位置就留空。shop 留空，followUp 填 none。'
    : instructions + ' ' + followUp;
  const audio = typeof body?.audio === 'string' ? body.audio : '';
  if (audio ? audio.length > 1_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio) : !description || description.length > 160) {
    return Response.json({}, { status: 400 });
  }

  const key = process.env.ARK_API_KEY?.trim();
  const model = process.env.ARK_PLACE_MODEL?.trim();
  if (!key || !model) return Response.json({}, { status: 503 });

  try {
    const endpoint = audio ? 'chat/completions' : 'responses';
    const response = await fetch(`https://ark.cn-beijing.volces.com/api/v3/${endpoint}`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(audio ? {
        model,
        thinking: { type: 'disabled' },
        max_tokens: 256,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt + ' 返回 JSON 对象，包含字符串字段 name、clue、shop、followUp。' },
          { role: 'user', content: [{ type: 'input_audio', input_audio: { data: audio, format: 'm4a' } }] },
        ],
      } : {
        model,
        store: false,
        thinking: { type: 'disabled' },
        max_output_tokens: 256,
        input: [{ role: 'system', content: prompt }, { role: 'user', content: description }],
        text: { format: {
          type: 'json_schema',
          name: 'place_clue',
          strict: true,
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, clue: { type: 'string' }, shop: { type: 'string' }, followUp: { type: 'string', enum: ['none', 'venue', 'landmark'] } },
            required: ['name', 'clue', 'shop', 'followUp'],
            additionalProperties: false,
          },
        } },
      }),
    });
    if (!response.ok) return Response.json({}, { status: 502 });
    const result = await response.json() as {
      choices?: { message?: { content?: string } }[];
      output?: { type: string; content?: { type: string; text?: string }[] }[];
    };
    const output = audio ? result.choices?.[0]?.message?.content : result.output?.find(item => item.type === 'message')
      ?.content?.find(item => item.type === 'output_text')?.text;
    const fields = JSON.parse(output ?? '');
    if (typeof fields?.name !== 'string' || typeof fields?.clue !== 'string') {
      return Response.json({}, { status: 502 });
    }
    const name = fields.name.trim();
    const extractedShop = typeof fields.shop === 'string' ? fields.shop.trim() : '';
    const inferredShop = fields.followUp === 'venue' || /^(tims(?:咖啡|天好咖啡)?|天好咖啡|提姆咖啡)$/.test(normalize(name)) ? name : '';
    const shopKeyword = refining ? '' : (extractedShop || inferredShop).slice(0, 80);
    const area = typeof body?.area === 'string' ? body.area.slice(0, 80) : '';
    const shops = shopKeyword ? await findShop(isPoint(body?.point) ? body.point : undefined, shopKeyword, area) : [];
    const shop = shops.length === 1 ? shops[0] : undefined;
    const clue = fields.clue.trim();
    const hasDistinctSeat = /第[一二三四五六七八九十百两0-9]+[把张个位]/.test(name)
      && /靠窗|窗边|靠门|门口|左|右|旁|楼/.test(name + clue);
    return Response.json({
      ...(shop ? { shop: shop.name, shopPoint: 'point' in shop ? shop.point : undefined } : {}),
      ...(shops.length > 1 ? { shops: shops.map(candidate => candidate.name), shopCandidates: shops } : {}),
      followUp: !refining && !hasDistinctSeat && (fields.followUp === 'venue' || fields.followUp === 'landmark') ? fields.followUp : 'none',
      name: (name || shopKeyword).slice(0, 40),
      clue: clue.slice(0, 80),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({}, { status: 502 });
  }
}
