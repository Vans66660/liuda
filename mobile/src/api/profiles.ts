import { collection } from './cloud';
import { PROFILES_COLLECTION } from './config';
import type { Profile } from '../state/profile-data';

/**
 * 账号资料（昵称/头像）云端读写。
 * 文档 _id = authorId，字段 nickname / avatar / updatedAt。
 * 头像用 base64 data URI 存（≤350KB，来自 profile-data 的校验）。
 */

/** 拉取某账号的云端资料；无记录或读失败都返回 null，由调用方决定是否用本地默认。 */
export async function fetchProfile(authorId: string): Promise<Profile | null> {
  try {
    const { data } = await collection(PROFILES_COLLECTION).doc(authorId).get();
    const doc = Array.isArray(data) ? data[0] : data;
    if (!doc || typeof doc !== 'object') return null;
    const nickname = typeof doc.nickname === 'string' ? doc.nickname.trim() : '';
    if (!nickname) return null;
    const avatar = typeof doc.avatar === 'string' && doc.avatar.length <= 350000 ? doc.avatar : null;
    return { version: 1, nickname, avatar };
  } catch {
    return null;
  }
}

/** upsert 账号资料到云端。失败抛错，由调用方提示。 */
export async function putProfile(authorId: string, profile: Profile): Promise<void> {
  await collection(PROFILES_COLLECTION).doc(authorId).set({
    nickname: profile.nickname,
    avatar: profile.avatar,
    updatedAt: Date.now(),
  });
}
