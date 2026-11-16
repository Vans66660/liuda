import { collection, ensureSignedIn, type Doc } from './cloud';
import { PLACES_COLLECTION } from './config';
import type { Place } from '../state/places';

/**
 * 写入云端的文档内容。
 * Web / JS SDK 的 doc(id).set(data) 把参数直接当文档内容（不是小程序端的 { data: ... }），
 * 且参数里不允许出现 _id（_id 由 doc(id) 指定、数据库自动维护，否则报「不能更新_id的值」）。
 * 因此这里既不包一层 data，也不带 _id / id / owned。
 */
function toDoc(place: Place): Record<string, unknown> {
  const doc: Record<string, unknown> = { ...place };
  delete doc.id;
  delete doc.owned;
  return doc;
}

/**
 * 解包 EJSON 扩展数字。
 * 早期经 @cloudbase/js-sdk 写入的文档，数字是 {"$numberInt":"80"} 这类扩展格式；
 * 现在经纯 HTTP API 写入的是普通数字。两种都要能读。
 */
function unwrapNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const box = value as Record<string, unknown>;
    if (typeof box.$numberInt === 'string' && Number.isFinite(Number(box.$numberInt))) return Number(box.$numberInt);
    if (typeof box.$numberDouble === 'string' && Number.isFinite(Number(box.$numberDouble))) return Number(box.$numberDouble);
    if (typeof box.$numberLong === 'string' && Number.isFinite(Number(box.$numberLong))) return Number(box.$numberLong);
    if (typeof box.$numberDecimal === 'string' && Number.isFinite(Number(box.$numberDecimal))) return Number(box.$numberDecimal);
  }
  return NaN;
}

/** 云端脏数据不能污染 UI：这里做一次最小结构校验。 */
function fromDoc(doc: Doc): Place | null {
  const id = typeof doc._id === 'string'
    ? doc._id
    : typeof doc.id === 'string' ? doc.id : '';
  if (!id || typeof doc.name !== 'string' || typeof doc.text !== 'string'
    || typeof doc.teaser !== 'string' || typeof doc.location !== 'string') return null;

  const mood = doc.mood === 'sage' || doc.mood === 'sand' || doc.mood === 'blue'
    ? doc.mood : 'sage';
  const replies = Array.isArray(doc.replies)
    ? (doc.replies as unknown as Place['replies']) : [];

  const place: Place = {
    id,
    name: doc.name,
    location: doc.location,
    teaser: doc.teaser,
    text: doc.text,
    mood,
    replies,
    distance: Number.isFinite(unwrapNumber(doc.distance)) ? unwrapNumber(doc.distance) : 0,
    likes: Number.isFinite(unwrapNumber(doc.likes)) ? unwrapNumber(doc.likes) : 0,
    liked: doc.liked === true,
    participated: doc.participated === true,
    owned: doc.owned === true,
    authorId: typeof doc.authorId === 'string' ? doc.authorId : undefined,
  };
  if (typeof doc.customLocationId === 'string') {
    place.customLocationId = doc.customLocationId;
  }
  if (doc.point && typeof doc.point === 'object') {
    const point = doc.point as Record<string, unknown>;
    place.point = {
      latitude: unwrapNumber(point.latitude),
      longitude: unwrapNumber(point.longitude),
    };
  }
  if (doc.media && typeof doc.media === 'object') {
    place.media = doc.media as unknown as Place['media'];
  }
  if (doc.task && typeof doc.task === 'object') {
    const task = doc.task as Record<string, unknown>;
    place.task = {
      title: typeof task.title === 'string' ? task.title : '',
      reward: Number.isFinite(unwrapNumber(task.reward)) ? unwrapNumber(task.reward) : 0,
      requirement: typeof task.requirement === 'string' ? task.requirement : '',
    };
  }
  return place;
}

/** 拉取共享留话（所有团队成员读到同一份云端数据）。 */
export async function fetchCloudPlaces(limit = 100): Promise<Place[]> {
  await ensureSignedIn();
  const { data } = await collection(PLACES_COLLECTION).limit(limit).get();
  if (!Array.isArray(data)) return [];
  return data.map(fromDoc).filter((place): place is Place => place !== null);
}

/** 新增或修改一条留话；doc(id).set 带 upsert，文档不存在时自动创建。 */
export async function putCloudPlace(place: Place): Promise<void> {
  await ensureSignedIn();
  await collection(PLACES_COLLECTION).doc(place.id).set(toDoc(place));
}

/** 真删除云端文档，不写墓碑；删除失败由调用方明确提示，不静默放行。 */
export async function removeCloudPlace(id: string): Promise<void> {
  await ensureSignedIn();
  await collection(PLACES_COLLECTION).doc(id).remove();
}
