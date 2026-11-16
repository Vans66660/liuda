import AsyncStorage from '@react-native-async-storage/async-storage';
import { CLOUDBASE_ENV_ID } from './config';

/**
 * ── 纯 HTTP 实现 ──
 *
 * @cloudbase/js-sdk v3 是浏览器/小程序环境 SDK，内部直接访问 localStorage、window 等
 * 浏览器 API，在 React Native 下会报 "property 'localStorage' doesn't exist"。
 * Expo Go 不能用原生模块，所以不能用 RN 适配器方案。
 *
 * 这里直接用 fetch 调 CloudBase HTTP OpenAPI：
 *   - 匿名登录：POST /auth/v1/signin/anonymously
 *   - 数据库 CRUD：/api/v2/envs/{envId}/databases/{collection}/documents...
 *
 * Token 存在 AsyncStorage，不依赖 localStorage。
 */

const API_BASE = 'https://tcb-api.tencentcloudapi.com';

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

// ── Token 管理 ──

type Credentials = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
};

const TOKEN_KEY = 'cloudbase_token_v1';
let cachedCred: Credentials | null = null;

async function loadCred(): Promise<Credentials | null> {
  if (cachedCred) {
    if (cachedCred.expires_at && Date.now() > cachedCred.expires_at) {
      cachedCred = null;
    } else {
      return cachedCred;
    }
  }
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const cred = JSON.parse(raw) as Credentials;
    if (cred.expires_at && Date.now() > cred.expires_at) {
      await AsyncStorage.removeItem(TOKEN_KEY);
      return null;
    }
    cachedCred = cred;
    return cred;
  } catch {
    return null;
  }
}

async function saveCred(cred: Credentials): Promise<void> {
  cachedCred = cred;
  try {
    await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(cred));
  } catch {
    // 落盘失败不影响本次会话使用
  }
}

// ── 匿名登录 ──

/**
 * 团队内部版不接短信、不做注册：用匿名登录建立真实会话，
 * 让文档型集合的读写带上身份。匿名登录需先在控制台开启。
 */
export async function ensureSignedIn(): Promise<void> {
  const existing = await loadCred();
  if (existing) return;

  const resp = await fetch(`${API_BASE}/auth/v1/signin/anonymously`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SDK-Version': 'liuda-http/1.0',
    },
    body: JSON.stringify({ envId: CLOUDBASE_ENV_ID }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`匿名登录失败 (${resp.status}): ${text.slice(0, 200)}`);
  }

  const body = await resp.json();
  // 响应格式：{ statusCode: 200, data: { access_token, refresh_token, expires_in, ... } }
  const data = body?.data ?? body;
  const accessToken = data?.access_token;
  if (!accessToken) {
    throw new Error(`匿名登录返回异常: ${JSON.stringify(body).slice(0, 300)}`);
  }

  const expiresIn: number | undefined = data?.expires_in;
  await saveCred({
    access_token: accessToken,
    refresh_token: data?.refresh_token,
    expires_at: expiresIn ? Date.now() + (expiresIn - 30) * 1000 : undefined,
  });
}

// ── HTTP 请求封装 ──

async function authedFetch(path: string, init: RequestInit = {}): Promise<any> {
  const cred = await loadCred();
  if (!cred) {
    throw new Error('未登录：请先调用 ensureSignedIn()');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cred.access_token}`,
    ...((init.headers as Record<string, string>) || {}),
  };

  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (resp.status === 401) {
    // Token 过期，清除后重试一次
    cachedCred = null;
    try { await AsyncStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    await ensureSignedIn();
    const newCred = await loadCred();
    if (!newCred) throw new Error('重新登录失败');
    headers.Authorization = `Bearer ${newCred.access_token}`;
    const retry = await fetch(`${API_BASE}${path}`, { ...init, headers });
    if (!retry.ok) {
      const text = await retry.text().catch(() => '');
      throw new Error(`云端请求失败 (${retry.status}): ${text.slice(0, 200)}`);
    }
    return retry.json();
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`云端请求失败 (${resp.status}): ${text.slice(0, 200)}`);
  }

  return resp.json();
}

// ── 数据库操作 ──

function dbPath(collection: string): string {
  return `/api/v2/envs/${CLOUDBASE_ENV_ID}/databases/${collection}/documents`;
}

/**
 * 创建 Collection 句柄。接口签名与之前 SDK 版本完全一致，
 * places.ts 和 invite.ts 不需要改动。
 */
export function collection(name: string): Collection {
  const basePath = dbPath(name);

  return {
    // 查询全部 / 限制数量
    limit(n: number): LimitQuery {
      return {
        async get(): Promise<QueryResult> {
          const path = `${basePath}?limit=${n}`;
          const body = await authedFetch(path);
          const list = parseDocList(body);
          return { data: list };
        },
      };
    },

    // 条件查询
    where(cond: Record<string, unknown>): WhereQuery {
      return {
        limit(n: number): LimitQuery {
          return {
            async get(): Promise<QueryResult> {
              const path = `${basePath}:find?limit=${n}&skip=0&fields=${encodeURIComponent('{}')}&sort=${encodeURIComponent('{}')}`;
              const body = await authedFetch(path, {
                method: 'POST',
                body: JSON.stringify({ query: JSON.stringify(cond) }),
              });
              const list = parseDocList(body);
              return { data: list };
            },
          };
        },
      };
    },

    // 查询全部
    async get(): Promise<QueryResult> {
      const path = `${basePath}?limit=100`;
      const body = await authedFetch(path);
      const list = parseDocList(body);
      return { data: list };
    },

    // 单文档操作
    doc(id: string): DocRef {
      const docPath = `${basePath}/${id}`;
      return {
        async get(): Promise<{ data: Doc | Doc[] }> {
          const body = await authedFetch(docPath);
          const list = parseDocList(body);
          return { data: list.length > 0 ? list[0] : list };
        },

        async set(payload: Record<string, unknown>): Promise<unknown> {
          // OpenAPI setDocument: PUT 或 POST update
          // 使用 POST /api/v2/envs/{envId}/databases/{collection}/documents/{docId}
          // 带 upsert 语义（set 不存在则创建）
          const body = await authedFetch(docPath, {
            method: 'PUT',
            body: JSON.stringify({ data: JSON.stringify(payload) }),
          });
          return body;
        },

        async remove(): Promise<unknown> {
          const body = await authedFetch(docPath, { method: 'DELETE' });
          return body;
        },
      };
    },

    // 新增文档
    async add(payload: Record<string, unknown>): Promise<unknown> {
      const body = await authedFetch(basePath, {
        method: 'POST',
        body: JSON.stringify({ data: JSON.stringify(payload) }),
      });
      return body;
    },
  };
}

// ── 响应解析 ──

/**
 * CloudBase OpenAPI 返回的文档列表有几种可能的格式：
 * 1. { statusCode: 200, data: { list: ["ejson_str", ...], offset, limit } }
 * 2. { statusCode: 200, data: [{...}, ...] }
 * 3. { statusCode: 200, data: { data: [...] } }
 *
 * pgdoc 模式下文档通常是普通 JSON（不需要 EJSON 反序列化）。
 */
function parseDocList(body: any): Doc[] {
  if (!body) return [];
  const data = body.data ?? body;

  // 格式 1: { list: [...] }
  if (data?.list && Array.isArray(data.list)) {
    return data.list.map((item: any) => {
      if (typeof item === 'string') {
        try { return JSON.parse(item) as Doc; } catch { return { _id: item } as Doc; }
      }
      return item as Doc;
    });
  }

  // 格式 2: 直接是数组
  if (Array.isArray(data)) {
    return data as Doc[];
  }

  // 格式 3: { data: [...] }
  if (data?.data && Array.isArray(data.data)) {
    return data.data as Doc[];
  }

  // 单文档: 直接是对象
  if (typeof data === 'object' && data !== null) {
    return [data as Doc];
  }

  return [];
}

// ── 错误消息 ──

export function cloudErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/permission|denied|403|401|not\s*authorized/i.test(message)) {
    return '云端权限不足，请检查集合权限与匿名登录开关';
  }
  if (/network|fetch|timeout|failed|econn/i.test(message)) {
    return '连接云端失败，请检查网络与 EnvId';
  }
  return message || '云端请求失败';
}
