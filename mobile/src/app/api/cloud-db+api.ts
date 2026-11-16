import { CLOUDBASE_ENV_ID, CLOUDBASE_PUBLISHABLE_KEY } from '../../api/config';

/**
 * 云端数据库代理。
 *
 * 为什么需要代理：CloudBase v3 数据库路径里含 `(default)` 这样的括号。
 * Node/浏览器 fetch 能正确处理裸括号，但 RN 原生 fetch（iOS NSURLSession /
 * Android OkHttp）会错误编码，导致网关返回 invalid body json，真机读不到数据。
 *
 * 这里在 Node（Metro 的 API Route 运行时）发起真正的云端请求 —— 该环境已验证
 * 括号路径 100% 可用。手机只需把相对 path + body 发到本接口（走 devApiUrl）。
 *
 * 注意：这只代理数据库读写。地图等其他 API Routes 仍各自独立。
 * 手机需能连到开发服务器（Expo Go + tunnel 已满足）。
 */

// 注意：这里不带 /collections —— 前端传来的 path 已含该前缀（如
// /collections/invite_codes/documents?...）。早期版本在这里多加了一段，
// 导致路径变成 /collections/collections/... → 网关返回 invalid body json。
const DB_BASE = `https://${CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com/v1/database/instances/(default)/databases/(default)`;

type Payload = {
  path: string;       // 例如 /invite_codes/documents?offset=0&limit=100
  method?: string;    // GET / PATCH / POST
  body?: unknown;     // PATCH/POST 的 JSON body
};

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function POST(request: Request) {
  const respond = (obj: object, status = 200) =>
    Response.json(obj, { status, headers: { 'Cache-Control': 'no-store' } });

  const payload = await request.json().catch(() => null) as Payload | null;
  if (!payload || typeof payload.path !== 'string' || !payload.path.startsWith('/')) {
    return respond({ error: 'Invalid request' }, 400);
  }

  // 防止 path 里混入 host（SSRF 基本防护）：只允许相对路径。
  if (/^https?:|\/\//i.test(payload.path)) return respond({ error: 'Invalid path' }, 400);

  const method = (payload.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return respond({ error: 'Invalid method' }, 400);
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${CLOUDBASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': uuid(),
    };
    const init: RequestInit = { method, headers };
    if (payload.body !== undefined && method !== 'GET') {
      init.body = JSON.stringify(payload.body);
    }
    // 网关偶发 socket hang up / 5xx，做一次简单重试提升真机成功率
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetch(`${DB_BASE}${payload.path}`, { ...init, signal: AbortSignal.timeout(8000) });
        if (response.status < 500) break;
      } catch {
        if (attempt === 1) throw new Error('network');
      }
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!response) throw new Error('network');
    const text = await response.text();
    // 原样把云端响应透传回手机：状态码 + 正文。
    return new Response(response.status === 204 ? null : text, {
      status: response.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return respond({ error: 'Cloud request failed', detail: e instanceof Error ? e.message : String(e) }, 502);
  }
}
