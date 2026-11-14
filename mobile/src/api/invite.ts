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
    const { data } = await collection(INVITE_COLLECTION)
      .where({ code, active: true })
      .limit(1)
      .get();
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, message: '邀请码无效或已停用' };
    }
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: cloudErrorMessage(error) };
  }
}
