import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const key = 'liuda-author-v1';

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

type IdentityValue = {
  authorId: string | null;
  signInWithInvite: (code: string) => Promise<void>;
};

const IdentityContext = createContext<IdentityValue>({ authorId: null, signInWithInvite: async () => {} });

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [authorId, setAuthorId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadAuthorId().then(value => { if (active) setAuthorId(value); });
    return () => { active = false; };
  }, []);
  async function signInWithInvite(code: string) {
    const next = deriveAuthorId(code);
    try { await AsyncStorage.setItem(key, next); } catch { /* 本次会话仍生效 */ }
    setAuthorId(next);
  }
  return <IdentityContext.Provider value={{ authorId, signInWithInvite }}>{children}</IdentityContext.Provider>;
}

export const useIdentity = () => useContext(IdentityContext);
