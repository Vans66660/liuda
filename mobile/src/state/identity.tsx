import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { tryOccupySession, releaseSession, touchSession } from '../api/sessions';

const deviceKey = 'liuda-device-id-v1';

/**
 * 团队测试版用邀请码当作者身份：同一成员在不同设备上输入同一个码，会得到同一个 authorId，
 * 因此能删自己发的帖和自己的接话。写进共享文档的是派生哈希，不是邀请码明文。
 * 邀请码派生是确定性的，重新输入同一码得到同一 authorId，从而跨设备恢复同一账号数据。
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

/** 设备 ID：跨账号/跨启动稳定，用于判断邀请码是否被「另一台设备」占用。 */
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
  /** null 表示未登录。不持久化、不自动恢复：每次启动都要求重新登录。 */
  authorId: string | null;
  /** 当前是否用邀请码身份。 */
  isInvite: boolean;
  signInWithInvite: (code: string) => Promise<SignInResult>;
  /** 游客（先逛逛）身份：本机临时身份，不持久化。 */
  signInAsGuest: () => void;
  /** 活跃心跳：刷新邀请码占用时间，失败不阻断。 */
  touch: () => Promise<void>;
  /** 退出登录：释放占用并回到未登录。 */
  signOut: () => Promise<void>;
};

const IdentityContext = createContext<IdentityValue>({
  authorId: null,
  isInvite: false,
  signInWithInvite: async () => ({ ok: false, message: '' }),
  signInAsGuest: () => {},
  touch: async () => {},
  signOut: async () => {},
});

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadDeviceId().then(value => { if (active) setDeviceId(value); });
    return () => { active = false; };
  }, []);

  async function signInWithInvite(code: string): Promise<SignInResult> {
    const next = deriveAuthorId(code);
    const device = deviceId ?? await loadDeviceId();
    // 一人一码互斥：被其他设备占用则拒绝登录
    const check = await tryOccupySession(next, device);
    if (!check.ok) return check;
    setAuthorId(next);
    return { ok: true, message: '' };
  }

  function signInAsGuest() {
    const guest = 'guest-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    setAuthorId(guest);
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
    setAuthorId(null);
  }

  const isInvite = typeof authorId === 'string' && authorId.startsWith('inv-');
  return <IdentityContext.Provider value={{ authorId, isInvite, signInWithInvite, signInAsGuest, touch, signOut }}>{children}</IdentityContext.Provider>;
}

export const useIdentity = () => useContext(IdentityContext);
