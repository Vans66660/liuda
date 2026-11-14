import { collection, ensureSignedIn, type Doc } from './cloud';
import { PLACES_COLLECTION } from './config';
import type { Place } from '../state/places';

type StoredPlace = Omit<Place, 'id'> & { _id: string };

function toDoc(place: Place): StoredPlace {
  const { id, ...rest } = place;
  return { ...rest, _id: id };
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
    distance: Number.isFinite(doc.distance) ? Number(doc.distance) : 0,
    likes: Number.isFinite(doc.likes) ? Number(doc.likes) : 0,
    liked: doc.liked === true,
    participated: doc.participated === true,
    owned: doc.owned === true,
  };
  if (typeof doc.customLocationId === 'string') {
    place.customLocationId = doc.customLocationId;
  }
  if (doc.point && typeof doc.point === 'object') {
    place.point = doc.point as unknown as Place['point'];
  }
  if (doc.media && typeof doc.media === 'object') {
    place.media = doc.media as unknown as Place['media'];
  }
  if (doc.task && typeof doc.task === 'object') {
    place.task = doc.task as unknown as Place['task'];
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

/** 新增或修改一条留话；doc(_id).set 同时覆盖新建与更新。 */
export async function putCloudPlace(place: Place): Promise<void> {
  await ensureSignedIn();
  await collection(PLACES_COLLECTION).doc(place.id).set({ data: toDoc(place) });
}
