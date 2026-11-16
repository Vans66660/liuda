import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { tryOccupySession, releaseSession, touchSession } from '../api/sessions';

const key = 'liuda-author-v1';
const deviceKey = 'liuda-device-id-v1';

/**
 * 团队测试版用邀请码当作者身份：同一成员在不同设备上输入同一个码，会得到同一个 authorId，
 * 因此能删自己发的帖和自己的接话。写进共享文档的是派生哈希，不是邀请码明文。
 */
function deriveAuthorId(code: string): string {
  const text = 'liuda:' + code.trim().toUpperCase();
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 'inv-' + hash.toString(36);
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function loadAuthorId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (stored) return stored;
  } catch {
    // 读不到时继续用下面的本机身份兜底。
  }
  // 未使用邀请码（先逛逛）也有稳定身份，只能删本机自己发的内容。
  const guest = 'guest-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  try { await AsyncStorage.setItem(key, guest); } catch { /* 本机身份不落盘时仍可用到本次会话结束 */ }
  return guest;
}

/** 设备 ID：跨账号/跨会话稳定，用于判断邀请码是否被"另一台设备"占用。 */
async function loadDeviceId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(deviceKey);
    if (stored) return stored;
  } catch { /* 读不到则新生成 */ }
  const id = uuid();
  try { await AsyncStorage.setItem(deviceKey, id); } catch { /* 本次会话仍可用 */ }
  return id;
}

export type SignInResult = { ok: boolean; message: string };

type IdentityValue = {
  authorId: string | null;
  /** 当前是否用邀请码身份（false 表示游客/未登录）。 */
  isInvite: boolean;
  signInWithInvite: (code: string) => Promise<SignInResult>;
  /** 活跃心跳：刷新邀请码占用时间，失败不阻断。 */
  touch: () => Promise<void>;
  /** 退出当前身份：释放占用并退回游客身份。 */
  signOut: () => Promise<void>;
};

const IdentityContext = createContext<IdentityValue>({
  authorId: null,
  isInvite: false,
  signInWithInvite: async () => ({ ok: false, message: '' }),
  touch: async () => {},
  signOut: async () => {},
});

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadAuthorId().then(value => { if (active) setAuthorId(value); });
    void loadDeviceId().then(value => { if (active) setDeviceId(value); });
    return () => { active = false; };
  }, []);

  async function signInWithInvite(code: string): Promise<SignInResult> {
    const next = deriveAuthorId(code);
    const device = deviceId ?? await loadDeviceId();
    // 一人一码互斥：被其他设备占用则拒绝登录
    const check = await tryOccupySession(next, device);
    if (!check.ok) return check;
    try { await AsyncStorage.setItem(key, next); } catch { /* 本次会话仍生效 */ }
    setAuthorId(next);
    return { ok: true, message: '' };
  }

  async function touch() {
    if (!authorId || !authorId.startsWith('inv-')) return;
    const device = deviceId ?? await loadDeviceId();
    await touchSession(authorId, device);
  }

  async function signOut() {
    if (authorId && authorId.startsWith('inv-')) {
      void releaseSession(authorId);
    }
    // 退回游客身份而不是留空：保持"我的留话"归属判断可用，也避免下次启动重复分配。
    const guest = 'guest-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    try { await AsyncStorage.setItem(key, guest); } catch { /* 本次会话仍生效 */ }
    setAuthorId(guest);
  }

  // 邀请码派生的 id 前缀是 inv-，游客是 guest-
  const isInvite = typeof authorId === 'string' && authorId.startsWith('inv-');
  return <IdentityContext.Provider value={{ authorId, isInvite, signInWithInvite, touch, signOut }}>{children}</IdentityContext.Provider>;
}

export const useIdentity = () => useContext(IdentityContext);
