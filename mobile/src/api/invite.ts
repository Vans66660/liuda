import { cloudErrorMessage, collection, ensureSignedIn } from './cloud';
import { INVITE_COLLECTION } from './config';

export type InviteResult = { ok: boolean; message: string };

/**
 * 团队内部邀请码校验。
 * 邀请码存在云端的 invite_codes 集合（字段 code / active），
 * 校验失败一律明确返回原因，绝不静默放行。
 * 本版不含短信验证码、邮箱验证码或任何注册流程。
 */
export async function verifyInviteCode(raw: string): Promise<InviteResult> {
  const code = raw.trim().toUpperCase();
  if (!code) return { ok: false, message: '请输入邀请码' };
  try {
    await ensureSignedIn();
    // 邀请码只有个位数，直接全量拉取后在本地匹配。
    // 不用 where({code, active}) 条件查询：RN 的 fetch 对 URL query 参数里的
    // JSON 编码行为与 Node/Web 不完全一致，曾导致真机上查不到但服务端能查到。
    const { data } = await collection(INVITE_COLLECTION).limit(100).get();
    const rows = Array.isArray(data) ? data : [];
    const hit = rows.find(row =>
      typeof row.code === 'string'
      && row.code.trim().toUpperCase() === code
      && row.active === true,
    );
    if (!hit) {
      return {
        ok: false,
        message: rows.length === 0
          ? '云端未读到邀请码，请检查网络后重试'
          : '邀请码无效或已停用',
      };
    }
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: cloudErrorMessage(error) };
  }
}
