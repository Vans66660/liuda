import Constants from 'expo-constants';
import { Platform } from 'react-native';

// API Route 在浏览器里有 origin，可以用相对路径；原生端（尤其 Expo Go）没有 origin，
// fetch('/api/...') 会直接失败，必须拼成开发服务器的绝对地址。
// Expo 公网隧道要求 HTTPS，HTTP 重定向可能会丢失 POST 请求体。
export function devApiUrl(path: string): string | null {
  if (Platform.OS === 'web') return path;
  const legacy = Constants as unknown as { manifest?: { debuggerHost?: string } };
  const raw = Constants.expoConfig?.hostUri ?? legacy.manifest?.debuggerHost;
  const host = raw?.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '');
  if (!host) return null;
  const secure = /^(https|exps):\/\//i.test(raw ?? '')
    || /\.(on\.expo\.app|exp\.direct)(?::\d+)?$/i.test(host);
  return `${secure ? 'https' : 'http'}://${host}${path}`;
}
