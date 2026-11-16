import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { decodeProfile, defaultProfile, normalizeProfile, type Profile } from './profile-data';
import { fetchProfile, putProfile } from '../api/profiles';
import { useIdentity } from './identity';

type ProfileStore = {
  profile: Profile;
  ready: boolean;
  notice: string;
  save: (input: { nickname: string; avatar: string | null }) => Promise<void>;
};
const ProfileContext = createContext<ProfileStore | null>(null);

/** 本地缓存按账号隔离，避免切换邀请码后串数据。 */
function cacheKey(authorId: string | null): string {
  return authorId ? `liuda-profile-${authorId}` : 'liuda-profile-guest';
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { authorId } = useIdentity();
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  // ready 由「已为哪个账号加载」派生，切换账号时自动变 false
  const ready = authorId !== null && loadedFor === authorId;

  // authorId 变化时重新加载对应账号的资料（本地缓存 → 云端覆盖）
  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorId) return; // 等身份就绪
      const storageKey = cacheKey(authorId);
      let local: Profile = defaultProfile;

      // 1) 本地缓存先渲染
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const decoded = decodeProfile(raw);
          local = decoded;
          if (active) setProfile(decoded);
        }
      } catch {
        if (active) setNotice('资料未能读取，当前使用默认身份。');
      }

      // 2) 云端资料覆盖（登录后跨设备一致）
      try {
        const remote = await fetchProfile(authorId);
        if (!active) return;
        if (remote) {
          setProfile(remote);
          try { await AsyncStorage.setItem(storageKey, JSON.stringify(remote)); } catch { /* 忽略 */ }
        } else if (authorId.startsWith('inv-')) {
          // 首次用该邀请码登录：把本地读到的资料作为云端初始值，后续设备读到一致资料
          void putProfile(authorId, local).catch(() => {});
        }
      } catch { /* 云端失败不阻断，资料仍可用本地缓存 */ }

      if (active) setLoadedFor(authorId);
    })();
    return () => { active = false; };
  }, [authorId]);

  async function save(input: { nickname: string; avatar: string | null }) {
    const next = normalizeProfile(input);
    const storageKey = cacheKey(authorId);
    try { await AsyncStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { throw new Error('资料未保存成功，请稍后重试。你的修改仍保留在此页。'); }
    setProfile(next);
    setNotice('');
    // 云端同步：邀请码账号才上云；游客只存本机
    if (authorId && authorId.startsWith('inv-')) {
      try {
        await putProfile(authorId, next);
      } catch {
        setNotice('资料已保存到本机，但云端同步失败：请稍后重试。');
      }
    }
  }

  return <ProfileContext.Provider value={{ profile, ready, notice, save }}>{children}</ProfileContext.Provider>;
}
export function useProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error('ProfileProvider is required');
  return value;
}

