import cloudbase from '@cloudbase/js-sdk';
import { CLOUDBASE_ENV_ID } from './config';

/**
 * 文档型数据库的最小类型边界。
 * SDK v3 的类型非常宽，这里只声明本项目真正用到的集合操作，避免业务代码
 * 直接依赖 SDK 内部类型；运行时行为仍以云开发控制台的实际配置为准。
 */
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

type Auth = {
  getLoginState(): Promise<unknown>;
  signInAnonymously?: () => Promise<unknown>;
  anonymousAuthProvider?: () => { signIn(): Promise<unknown> };
};

type CloudApp = {
  auth(): Auth;
  database(): { collection(name: string): Collection };
};

let cached: CloudApp | null = null;

/** 整个 App 只初始化一次 CloudBase 客户端。 */
export function cloud(): CloudApp {
  if (!cached) {
    cached = cloudbase.init({ env: CLOUDBASE_ENV_ID }) as unknown as CloudApp;
  }
  return cached;
}

export function collection(name: string): Collection {
  return cloud().database().collection(name);
}

/**
 * 团队内部版不接短信、不做注册：用匿名登录建立真实会话，
 * 让文档型集合的读写带上身份。匿名登录需先在控制台开启。
 */
export async function ensureSignedIn(): Promise<void> {
  const auth = cloud().auth();
  const state = await auth.getLoginState();
  if (state) return;
  if (auth.signInAnonymously) {
    await auth.signInAnonymously();
    return;
  }
  if (auth.anonymousAuthProvider) {
    await auth.anonymousAuthProvider().signIn();
    return;
  }
  throw new Error('当前环境未开启匿名登录，请在云开发控制台「身份认证 → 登录方式」开启');
}

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
