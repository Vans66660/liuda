import { CLOUDBASE_ENV_ID, CLOUDBASE_PUBLISHABLE_KEY } from './config';

/**
 * ── 纯 HTTP 实现（Publishable Key 鉴权）──
 *
 * @cloudbase/js-sdk v3 是浏览器/小程序 SDK，内部访问 localStorage/window，
 * 在 React Native（Expo Go）下会报 "property 'localStorage' doesn't exist"。
 * 匿名登录 HTTP 接口在免费体验版上又返回 LOGIN_TYPE_DISABLED（即使控制台已开启）。
 *
 * 因此直接用 fetch 调 CloudBase v3 HTTP API，用 Publishable Key 鉴权：
 *   - Publishable Key 是公开凭证（匿名角色），可安全放前端，无需登录
 *   - 鉴权：Authorization: Bearer <publishable_key>
 *   - host: https://{env}.api.tcloudbasegateway.com/v1
 *   - 集合路径: /database/instances/(default)/databases/(default)/collections/{name}/documents
 * 以上 host/路径/请求格式均按 @cloudbase/js-sdk v3 源码逐一实测验证过。
 */

// 括号用 URL 编码（%28/%29）：Node 的 fetch 容忍裸括号，但 RN 原生 fetch
// （iOS NSURLSession / Android OkHttp）对 URL 里的裸括号处理不一致，可能导致
// 请求路径不匹配、返回空。编码后两种环境服务端都能正确解析（已实测）。
const API_BASE = `https://${CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com/v1/database/instances/%28default%29/databases/%28default%29/collections`;

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

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 最后一次请求的诊断信息（真机排障用）。 */
export const cloudDebug: { url: string; status: number; raw: string; error: string } = {
  url: '', status: 0, raw: '', error: '',
};

/** 所有请求共用 Publishable Key 作为 Bearer token，无需登录/刷新。 */
async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${CLOUDBASE_PUBLISHABLE_KEY}`,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-Id': uuid(),
    ...((init.headers as Record<string, string>) || {}),
  };
  const url = `${API_BASE}${path}`;
  cloudDebug.url = url;
  cloudDebug.error = '';
  let resp: Response;
  let text = '';
  try {
    resp = await fetch(url, { ...init, headers });
    cloudDebug.status = resp.status;
    text = await resp.text();
    cloudDebug.raw = text.slice(0, 500);
  } catch (e) {
    cloudDebug.error = e instanceof Error ? e.message : String(e);
    throw new Error(`网络请求失败: ${cloudDebug.error}`);
  }
  let body: any;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }

  if (!resp.ok || body?.code || body?.Error) {
    const code = body?.code ?? body?.Error?.Code ?? resp.status;
    const message = body?.message ?? body?.Error?.Message ?? text ?? '云端请求失败';
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
