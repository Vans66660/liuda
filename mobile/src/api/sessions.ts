import { cloudErrorMessage, collection } from './cloud';
import { SESSIONS_COLLECTION, SESSION_TTL_MS } from './config';

/**
 * 邀请码登录占用管理（一人一码、同码互斥）。
 * 文档 _id = authorId，字段 deviceId / lastSeen。
 * lastSeen 超过 SESSION_TTL_MS 视为设备已离线，允许其他设备登录。
 */

export type SessionCheck = { ok: boolean; message: string };

/**
 * 解包 EJSON 数字。pgdoc 会把大整数存成 {"$numberLong":"..."}，
 * 读取时必须还原成数字，否则 lastSeen 永远被判为 0。
 */
function unwrapNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const box = value as Record<string, unknown>;
    for (const key of ['$numberLong', '$numberInt', '$numberDouble', '$numberDecimal']) {
      if (typeof box[key] === 'string' && Number.isFinite(Number(box[key]))) return Number(box[key]);
    }
  }
  return NaN;
}

/**
 * 尝试占用某个邀请码对应的账号：
 * - 该码已被其他设备在有效期内占用 → 拒绝
 * - 无占用 / 已过期 / 同一设备 → 登记并放行
 */
export async function tryOccupySession(authorId: string, deviceId: string): Promise<SessionCheck> {
  // 1) 先读当前占用（文档不存在时 get 抛错，视为无占用）
  try {
    const { data } = await collection(SESSIONS_COLLECTION).doc(authorId).get();
    const doc = Array.isArray(data) ? data[0] : data;
    if (doc && typeof doc === 'object') {
      const lastSeen = unwrapNumber(doc.lastSeen);
      const isOther = typeof doc.deviceId === 'string' && doc.deviceId !== deviceId;
      if (isOther && Number.isFinite(lastSeen) && Date.now() - lastSeen < SESSION_TTL_MS) {
        return { ok: false, message: '此邀请码已在其他设备登录，请稍后再试' };
      }
    }
  } catch { /* 读不到视为无占用；真正的网络故障会在下方 set 暴露 */ }

  // 2) 登记占用（upsert）
  try {
    await collection(SESSIONS_COLLECTION).doc(authorId).set({ deviceId, lastSeen: Date.now() });
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: '无法登记登录状态：' + cloudErrorMessage(error) };
  }
}

/** 活跃心跳：刷新 lastSeen，失败不影响主流程。 */
export async function touchSession(authorId: string, deviceId: string): Promise<void> {
  try {
    await collection(SESSIONS_COLLECTION).doc(authorId).set({ deviceId, lastSeen: Date.now() });
  } catch { /* 心跳失败忽略 */ }
}

/** 退出登录时释放占用（失败忽略）。 */
export async function releaseSession(authorId: string): Promise<void> {
  try {
    await collection(SESSIONS_COLLECTION).doc(authorId).remove();
  } catch { /* 释放失败忽略 */ }
}
