import { Redirect } from 'expo-router';
import { Loading } from '../components/ui';
import { useEntry } from '../state/entry';
import { useIdentity } from '../state/identity';
export default function EntryScreen() {
  const { ready } = useEntry();
  const { authorId } = useIdentity();
  if (!ready) return <Loading />;
  // 真实登录：未登录（authorId 为 null）一律先进登录页，不再静默恢复本地身份
  return <Redirect href={authorId ? '/discover' : '/welcome'} />;
}
