import { devApiUrl } from '../location/api';

/**
 * ── 经开发服务器代理的 CloudBase HTTP 实现 ──
 *
 * 背景：
 * - @cloudbase/js-sdk v3 依赖 localStorage/window，RN(Expo Go) 下直接报错。
 * - 匿名登录接口在免费环境返回 LOGIN_TYPE_DISABLED，改用 Publishable Key 鉴权。
 * - CloudBase v3 数据库路径含 `(default)` 括号：Node/浏览器 fetch 正常，但 RN
 *   原生 fetch 会错误编码（真机报 invalid body json），直连云端读不到数据。
 *
 * 最终方案：手机把相对 path + body 发给本项目的 API Route `/api/cloud-db`，
 * 由 Node（Metro 运行时）用裸括号 URL 请求云端（该环境已实测 100% 可用），
 * 再把云端响应原样透传回来。地图等功能本就用同样的 devApiUrl 代理模式。
 *
 * 代价：手机需能连到开发服务器（Expo Go + tunnel 已满足），电脑需保持在线。
 * 这和本项目其他 API Routes 的约束一致。
 */

// ── 类型 ──

export type Doc = Record<string, unknown> & { _id?: string };

type QueryResult = { data: Doc[] };
type LimitQuery = { get(): Promise<QueryResult> };
type WhereQuery = { limit(n: number): LimitQuery };
type DocRef = {
  get(): Promise<{ data: Doc | Doc[] }>;
  set(payload: Record<string, unknown>): Promise<unknown>;
  remove(): Promise<unknown>;
};
export type Collection = {
  where(cond: Record<string, unknown>): WhereQuery;
  limit(n: number): LimitQuery;
  get(): Promise<QueryResult>;
  doc(id: string): DocRef;
  add(payload: Record<string, unknown>): Promise<unknown>;
};

// ── HTTP 请求封装 ──

/** 最后一次请求的诊断信息（真机排障用）。 */
export const cloudDebug: { url: string; status: number; raw: string; error: string } = {
  url: '', status: 0, raw: '', error: '',
};

/**
 * 经 /api/cloud-db 代理执行云端请求。
 * path 是相对集合路径，例如 `/invite_codes/documents?offset=0&limit=100`。
 */
async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const method = (init.method as string) || 'GET';
  const proxyPath = '/api/cloud-db';
  const url = devApiUrl(proxyPath) ?? proxyPath; // web 用相对路径；原生用开发服务器绝对地址
  cloudDebug.url = url + ' → ' + path;
  cloudDebug.error = '';

  let resp: Response;
  let text = '';
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        method,
        body: init.body !== undefined ? JSON.parse(String(init.body)) : undefined,
      }),
    });
    cloudDebug.status = resp.status;
    text = await resp.text();
    cloudDebug.raw = text.slice(0, 500);
  } catch (e) {
    cloudDebug.error = e instanceof Error ? e.message : String(e);
    throw new Error(`连接开发服务器失败: ${cloudDebug.error}`);
  }

  let body: any;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }

  if (!resp.ok || body?.code || body?.Error || body?.error || body?.Response?.Error) {
    const code = body?.code ?? body?.Error?.Code ?? body?.Response?.Error?.Code ?? body?.error ?? resp.status;
    const message = body?.message ?? body?.Error?.Message ?? body?.Response?.Error?.Message
      ?? (typeof body?.error === 'string' ? body.error : body?.detail) ?? text ?? '云端请求失败';
    throw new Error(`[${code}] ${message}`);
  }
  return body;
}

// ── 数据库操作 ──

/**
 * 创建 Collection 句柄。接口签名与 SDK 版完全一致，
 * places.ts / invite.ts 不需要改动。
 */
export function collection(name: string): Collection {
  const base = `/collections/${name}`;

  return {
    /** 查询文档列表：GET .../documents?offset&limit&query */
    limit(n: number): LimitQuery {
      return {
        async get(): Promise<QueryResult> {
          const body = await apiFetch(`${base}/documents?offset=0&limit=${n}`);
          return { data: parseDocList(body) };
        },
      };
    },

    /** 条件查询：GET .../documents?offset&limit&query=<json> */
    where(cond: Record<string, unknown>): WhereQuery {
      return {
        limit(n: number): LimitQuery {
          return {
            async get(): Promise<QueryResult> {
              const query = encodeURIComponent(JSON.stringify(cond));
              const body = await apiFetch(`${base}/documents?offset=0&limit=${n}&query=${query}`);
              return { data: parseDocList(body) };
            },
          };
        },
      };
    },

    /** 查询全部（默认 100 条） */
    async get(): Promise<QueryResult> {
      const body = await apiFetch(`${base}/documents?offset=0&limit=100`);
      return { data: parseDocList(body) };
    },

    /** 单文档操作 */
    doc(id: string): DocRef {
      return {
        async get(): Promise<{ data: Doc | Doc[] }> {
          const body = await apiFetch(`${base}/documents/${encodeURIComponent(id)}`);
          // 单文档响应直接是文档对象
          return { data: body as Doc };
        },

        /**
         * upsert 写入：PATCH .../documents
         * query 用 _id 定位；data 里不含 _id（含 _id 会被拒：Invalid Key Name: _id）
         */
        async set(payload: Record<string, unknown>): Promise<unknown> {
          const body = await apiFetch(`${base}/documents`, {
            method: 'PATCH',
            body: JSON.stringify({
              query: { _id: id },
              data: payload,
              upsert: true,
              replaceMode: true,
            }),
          });
          return body;
        },

        /** 删除：POST .../documents/remove */
        async remove(): Promise<unknown> {
          const body = await apiFetch(`${base}/documents/remove`, {
            method: 'POST',
            body: JSON.stringify({ query: { _id: id } }),
          });
          return body;
        },
      };
    },

    /** 新增文档：POST .../documents */
    async add(payload: Record<string, unknown>): Promise<unknown> {
      const body = await apiFetch(`${base}/documents`, {
        method: 'POST',
        body: JSON.stringify({ data: payload }),
      });
      return body;
    },
  };
}

/**
 * 列表响应格式：{ offset, limit, list: [{_id, ...}, ...] }
 * 文档是普通 JSON（pgdoc 模式下无需 EJSON 反序列化）。
 */
function parseDocList(body: any): Doc[] {
  if (!body) return [];
  if (Array.isArray(body?.list)) return body.list as Doc[];
  if (Array.isArray(body)) return body as Doc[];
  if (Array.isArray(body?.data?.list)) return body.data.list as Doc[];
  if (Array.isArray(body?.data)) return body.data as Doc[];
  if (typeof body === 'object' && body !== null && body._id) return [body as Doc];
  return [];
}

/** 保留导出，places.tsx 里 import 了它；Publishable Key 方案下无需额外登录。 */
export async function ensureSignedIn(): Promise<void> {
  // no-op：Publishable Key 直接鉴权，不需要登录态
}

/** 把云端错误翻译成可操作的提示。 */
export function cloudErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/permission|denied|403|401|not\s*authorized|INVALID_ACCESS_TOKEN/i.test(message)) {
    return '云端权限不足，请检查集合权限与 Publishable Key';
  }
  if (/network|fetch|timeout|failed|econn/i.test(message)) {
    return '连接云端失败，请检查网络';
  }
  return message || '云端请求失败';
}
