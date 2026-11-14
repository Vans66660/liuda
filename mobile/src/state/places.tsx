import { File } from 'expo-file-system';
import { placeMediaUri, type PlaceMedia } from '../components/LeaveMedia';
import { atPoint, isPoint, type Fix, type Point } from '../location/geo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { fetchCloudPlaces, putCloudPlace, removeCloudPlace } from '../api/places';
import { cloudErrorMessage } from '../api/cloud';
import { useIdentity } from './identity';

export type Reply = { id: string; text: string; mine: boolean; authorId?: string };
export type Place = {
  id: string;
  name: string;
  location: string;
  distance: number;
  point?: Point;
  customLocationId?: string;
  media?: PlaceMedia;
  teaser: string;
  text: string;
  mood: 'sage' | 'sand' | 'blue';
  likes: number;
  liked: boolean;
  participated: boolean;
  owned: boolean;
  authorId?: string;
  replies: Reply[];
  task?: { title: string; reward: number; requirement: string };
};

/** 删除权限只认 authorId；旧版本本机缓存没有 authorId 时，才回退到本机 owned / mine 标记。 */
export function isMyPlace(place: Pick<Place, 'authorId' | 'owned'>, authorId: string | null): boolean {
  if (!authorId) return false;
  return place.authorId ? place.authorId === authorId : place.owned === true;
}
export function isMyReply(reply: Pick<Reply, 'authorId' | 'mine'>, authorId: string | null): boolean {
  if (!authorId) return false;
  return reply.authorId ? reply.authorId === authorId : reply.mine === true;
}

const initialPlaces: Place[] = [
  {
    id: 'bench', name: '第一张长椅', location: '图书馆西门 · 梧桐树下', distance: 80,
    teaser: '这里是我每天假装看书，实际发呆的地方。',
    text: '这里是我每天假装看书，实际发呆的地方。下午三点刚好有树荫。如果你也坐过，接一句吧。',
    mood: 'sage', likes: 23, liked: false, participated: false, owned: false,
    replies: [{ id: 'bench-1', text: '原来这张椅子还有固定的发呆时间。', mine: false }],
  },
  {
    id: 'stairs', name: '拐角的第三级台阶', location: '教学楼 · 东侧二层', distance: 140,
    teaser: '今天在这里摔了一跤，发现还不止我一个……',
    text: '今天在这里摔了一跤，发现还不止我一个。拐角处的台阶有点滑，路过时慢一点。有人知道另一侧有没有无障碍入口吗？',
    mood: 'sand', likes: 12, liked: false, participated: false, owned: false, replies: [],
    task: { title: '找到无障碍入口', reward: 5, requirement: '在现场确认入口，拍照并说明路线。当前仅展示任务设计，现金领取后续接入。' },
  },
  {
    id: 'corner', name: '风吹得到的角落', location: '操场北侧 · 连廊尽头', distance: 35,
    teaser: '今天什么也不想干，就在这里坐了十分钟。',
    text: '今天什么也不想干，就在这里坐了十分钟。风很舒服。你上次在这里，是在等人，还是也在放空？',
    mood: 'blue', likes: 8, liked: false, participated: true, owned: false,
    replies: [{ id: 'corner-1', text: '上次在这里等朋友。现在离开了，还是想接着聊。', mine: true }],
  },
];

/** removed 是本机删除记录，用于云端删除失败时防止重启后把文档拉回来「复活」。 */
type State = { places: Place[]; arrived: string[]; saved: string[]; removed: string[] };
type Store = State & {
  ready: boolean;
  notice: string;
  authorId: string | null;
  arrive: (id: string) => void;
  depart: (id: string) => void;
  save: (id: string) => void;
  like: (id: string, fix?: Fix | null) => void;
  reply: (id: string, text: string, fix?: Fix | null) => void;
  create: (name: string, location: string, text: string, point?: Point, media?: PlaceMedia, customLocation?: true | string) => string;
  removePlace: (id: string) => Promise<boolean>;
  removeReply: (placeId: string, replyId: string) => boolean;
};
const Context = createContext<Store | null>(null);
const key = 'liuda-mobile-demo-v1';

function validPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object') return false;
  const place = value as Place;
  return ['id', 'name', 'location', 'teaser', 'text'].every(field => typeof (place as unknown as Record<string, unknown>)[field] === 'string')
    && ['sage', 'sand', 'blue'].includes(place.mood)
    && (place.point === undefined || isPoint(place.point))
    && (place.customLocationId === undefined || typeof place.customLocationId === 'string')
    && (place.authorId === undefined || typeof place.authorId === 'string')
    && (place.media === undefined || (!!place.media && ['photo', 'voice'].includes(place.media.kind)
      && typeof place.media.file === 'string' && /^leave-[a-z0-9-]+[.](jpg|m4a)$/.test(place.media.file)))
    && Number.isFinite(place.distance) && Number.isFinite(place.likes)
    && ['liked', 'participated', 'owned'].every(field => typeof (place as unknown as Record<string, unknown>)[field] === 'boolean')
    && Array.isArray(place.replies) && place.replies.every(reply => typeof reply.id === 'string' && typeof reply.text === 'string'
      && typeof reply.mine === 'boolean' && (reply.authorId === undefined || typeof reply.authorId === 'string'))
    && (!place.task || (typeof place.task.title === 'string' && Number.isFinite(place.task.reward) && typeof place.task.requirement === 'string'));
}

export function PlacesProvider({ children }: { children: React.ReactNode }) {
  const { authorId } = useIdentity();
  const [state, setState] = useState<State>({ places: initialPlaces, arrived: [], saved: [], removed: [] });
  const [dataReady, setDataReady] = useState(false);
  const [notice, setNotice] = useState('');
  const ready = dataReady && authorId !== null;
  const writeQueue = useRef(Promise.resolve());
  const pending = useRef<string[]>([]);
  const cloudReady = useRef(false);
  const stateRef = useRef(state);

  // ref 只在 effect 里更新，避免在渲染期间读写 ref（react-hooks/refs）
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    let active = true;
    (async () => {
      // 1) 本机缓存先渲染：弱网/离线时 App 仍可用
      try {
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const stored = JSON.parse(raw) as State;
          const removed = Array.isArray(stored.removed) ? stored.removed : [];
          if (!Array.isArray(stored.places) || !stored.places.length || !stored.places.every(validPlace)
            || !Array.isArray(stored.arrived) || !stored.arrived.every(id => typeof id === 'string')
            || !Array.isArray(stored.saved) || !stored.saved.every(id => typeof id === 'string')
            || !removed.every(id => typeof id === 'string')) throw new Error('invalid cache');
          if (active) setState({ ...stored, removed });
        }
      } catch {
        if (active) setNotice('本机记录读取失败，当前展示初始演示内容。');
      } finally {
        if (active) setDataReady(true);
      }

      // 2) 云端共享留话；失败只提示，绝不假装已同步
      try {
        const remote = await fetchCloudPlaces();
        if (!active) return;
        cloudReady.current = true;
        if (remote.length === 0) {
          // 首次接入：把本机演示内容作为第一批共享数据写入云端
          const seeds = stateRef.current.places;
          void Promise.all(seeds.map(place => putCloudPlace(place))).catch(error => {
            if (active) setNotice('初始化云端数据失败：' + cloudErrorMessage(error));
          });
          return;
        }
        const remoteIds = new Set(remote.map(place => place.id));
        const localOnly = stateRef.current.places.filter(
          place => place.id.startsWith('local-') && !remoteIds.has(place.id),
        );
        setState(current => ({
          ...current,
          places: [...remote.filter(place => !current.removed.includes(place.id)), ...localOnly],
        }));
      } catch (error) {
        if (active) setNotice('云端同步暂不可用，改动先留在本机：' + cloudErrorMessage(error));
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!dataReady) return;
    const serialized = JSON.stringify(state);
    writeQueue.current = writeQueue.current.then(() => AsyncStorage.setItem(key, serialized)).catch(() => {
      setNotice('本机保存失败，关闭后这次修改可能丢失。');
    });

    // 只把用户操作产生的变更推上云，避免把刚拉回的数据又写回去
    const ids = pending.current.splice(0);
    if (!cloudReady.current || ids.length === 0) return;
    ids.forEach(id => {
      const place = state.places.find(item => item.id === id);
      if (!place) return;
      void putCloudPlace(place).catch(error => {
        setNotice('云端保存失败，改动已留在本机：' + cloudErrorMessage(error));
      });
    });
  }, [state, dataReady]);

  function arrive(id: string) {
    setState(current => ({ ...current, arrived: [...new Set([...current.arrived, id])] }));
  }
  function depart(id: string) {
    setState(current => ({ ...current, arrived: current.arrived.filter(value => value !== id) }));
  }
  function save(id: string) {
    setState(current => ({ ...current, saved: current.saved.includes(id) ? current.saved.filter(value => value !== id) : [...current.saved, id] }));
  }
  function like(id: string, fix?: Fix | null) {
    setState(current => ({ ...current, places: current.places.map(place => {
      if (place.id !== id || !(place.point ? atPoint(fix, place.point) : current.arrived.includes(id))) return place;
      pending.current.push(id);
      return { ...place, liked: !place.liked, likes: place.likes + (place.liked ? -1 : 1) };
    }) }));
  }
  function reply(id: string, text: string, fix?: Fix | null) {
    if (!text.trim()) return;
    setState(current => ({ ...current, places: current.places.map(place => {
      if (place.id !== id || (!place.participated && !(place.point ? atPoint(fix, place.point) : current.arrived.includes(id)))) return place;
      pending.current.push(id);
      return { ...place, participated: true, replies: [...place.replies, { id: Date.now() + '-' + Math.random(), text: text.trim(), mine: true, authorId: authorId ?? undefined }] };
    }) }));
  }
  function create(name: string, location: string, text: string, point?: Point, media?: PlaceMedia, customLocation?: true | string) {
    const id = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const place: Place = { id, name: name.trim() || '现场留话', location: location.trim(), text: text.trim(), teaser: text.trim() || (media?.kind === 'photo' ? '一张现场照片' : media?.kind === 'voice' ? '一段现场语音' : ''), distance: 0, point, media, customLocationId: customLocation === true ? id : customLocation, mood: 'sage', likes: 0, liked: false, participated: true, owned: true, authorId: authorId ?? undefined, replies: [] };
    pending.current.push(id);
    setState(current => ({ ...current, places: [place, ...current.places], arrived: point ? current.arrived : [...current.arrived, id] }));
    return id;
  }

  /** 真删除：只删自己的发帖。云端删除失败也保留本机删除结果，但会明确提示。 */
  async function removePlace(id: string): Promise<boolean> {
    const place = stateRef.current.places.find(item => item.id === id);
    if (!place || !isMyPlace(place, authorId)) return false;
    const mediaUri = place.media ? placeMediaUri(place.media) : null;
    pending.current = pending.current.filter(value => value !== id);
    setState(current => ({
      ...current,
      places: current.places.filter(item => item.id !== id),
      arrived: current.arrived.filter(value => value !== id),
      saved: current.saved.filter(value => value !== id),
      removed: [...new Set([...current.removed, id])],
    }));
    if (mediaUri) { try { new File(mediaUri).delete(); } catch { /* 文件可能已被系统清理 */ } }
    try {
      await removeCloudPlace(id);
    } catch (error) {
      setNotice('本机已删除，云端删除失败：' + cloudErrorMessage(error) + '。其他设备可能仍能看到，请稍后重试。');
    }
    return true;
  }

  /** 删除自己的接话：整份 Place 文档写回云端，不删除原帖。 */
  function removeReply(placeId: string, replyId: string): boolean {
    const place = stateRef.current.places.find(item => item.id === placeId);
    const reply = place?.replies.find(item => item.id === replyId);
    if (!place || !reply || !isMyReply(reply, authorId)) return false;
    pending.current.push(placeId);
    setState(current => ({ ...current, places: current.places.map(item => {
      if (item.id !== placeId) return item;
      const replies = item.replies.filter(value => value.id !== replyId);
      return { ...item, replies, participated: isMyPlace(item, authorId) || replies.some(value => isMyReply(value, authorId)) };
    }) }));
    return true;
  }

  return <Context.Provider value={{ ...state, ready, notice, authorId, arrive, depart, save, like, reply, create, removePlace, removeReply }}>{children}</Context.Provider>;
}

export function usePlaces() {
  const store = useContext(Context);
  if (!store) throw new Error('PlacesProvider is required');
  return store;
}
