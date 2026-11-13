import { placeMediaUri, VoicePlayback } from '../../components/LeaveMedia';
import { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlignedTextInput, KeyboardAlignedScrollView } from '../../components/KeyboardAlignedScrollView';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useProfile } from '../../state/profile';
import { LivePlacePosition } from '../../components/LivePlacePosition';
import { atPoint, type Fix } from '../../location/geo';
import { PlaceMiniMap } from '../../components/PlaceMiniMap';
import { Author } from '../../components/Author';
import { usePlaces } from '../../state/places';
import { Action, colors, Loading, moods, ui } from '../../components/ui';

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = usePlaces();
  const { ready: profileReady } = useProfile();
  const [position, setPosition] = useState<{ id: string; fix: Fix | null }>();
  const updatePosition = useCallback((fix: Fix | null) => setPosition({ id, fix }), [id]);
  const [draft, setDraft] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  if (!store.ready || !profileReady) return <Loading />;
  const place = store.places.find(value => value.id === id);
  if (!place) return <View style={[ui.screen, ui.content]}><Text style={ui.title}>这个地点暂时找不到了</Text><Action title="回到发现" onPress={() => router.replace('/')} /></View>;
  const point = place.point;
  const fix = position?.id === id ? position?.fix : null;
  const onsite = point ? atPoint(fix, point) : store.arrived.includes(place.id);
  const unlocked = onsite || place.participated;
  const palette = moods[place.mood];
  const locationClue = [place.name === '现场留话' ? '' : place.name, place.location].filter(Boolean).join(' · ');
  return <KeyboardAlignedScrollView style={ui.screen} contentContainerStyle={ui.content}>
      <View style={styles.locationSection}>
        {point
          ? <LivePlacePosition key={place.id} point={point} onFix={updatePosition} />
          : <>
            <PlaceMiniMap distance={place.distance} onsite={onsite} location={place.location} />
            <Action secondary title={onsite ? '模拟离开现场' : '模拟走近并到场'} onPress={() => onsite ? store.depart(place.id) : store.arrive(place.id)} />
          </>}
        {point && locationClue ? <Text style={ui.muted}>{locationClue}</Text> : null}
      </View>
      <View style={[ui.panel, { backgroundColor: palette.background }]}>
        {unlocked && place.media?.kind === 'photo' && <Image source={{ uri: placeMediaUri(place.media) }} style={styles.photo} resizeMode="contain" accessibilityLabel="现场照片" />}
        {unlocked && place.media?.kind === 'voice' && <VoicePlayback uri={placeMediaUri(place.media)} />}
        {(!unlocked || place.text) ? <Text style={[styles.originalText, { color: palette.ink }]}>{unlocked ? place.text : place.teaser}</Text> : null}
        <View style={styles.engagement}>
          <View style={styles.author}><Author mine={place.owned} original /></View>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !onsite, selected: place.liked }} disabled={!onsite} onPress={() => store.like(place.id, fix)} accessibilityLabel={onsite ? (place.liked ? '取消点赞' : '点赞') : '点赞需到场'} style={styles.like}>
            <Ionicons name={place.liked ? 'heart' : 'heart-outline'} size={19} color={place.liked ? '#e5b9a9' : palette.soft} />
            <Text style={{ color: palette.soft }}>{place.likes}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={store.saved.includes(place.id) ? '取消想去' : '标记想去'} onPress={() => store.save(place.id)} style={styles.bookmark}>
            <Ionicons name={store.saved.includes(place.id) ? 'bookmark' : 'bookmark-outline'} size={20} color={palette.soft} />
          </Pressable>
        </View>
      </View>
      {!unlocked && <Text style={ui.muted}>走近留言点，即可读完并接话。</Text>}
      {place.task && <View style={ui.panel}><Pressable onPress={() => setTaskOpen(!taskOpen)} style={styles.placeMeta}><Text style={[ui.body, { flex: 1 }]}>⚑ {place.task.title}</Text><Text style={{ color: colors.accent }}>¥{place.task.reward} · 演示</Text><Ionicons name={taskOpen ? 'chevron-up' : 'chevron-down'} size={17} color={colors.muted} /></Pressable>{taskOpen && <Text style={ui.muted}>{place.task.requirement} 此版本不支持任务提交、支付或提现。</Text>}</View>}
      {unlocked && <>
        <View style={styles.placeMeta}><Text style={styles.sectionTitle}>这里的接话</Text><Text style={ui.muted}>{place.replies.length} 句</Text></View>
        {place.replies.length === 0 ? <Text style={ui.muted}>还没有人接话。你可以留下第一句。</Text> : place.replies.map(item => <View key={item.id} style={[ui.panel, item.mine && styles.myReply]}><Author mine={item.mine} original={item.mine && place.owned} /><Text style={ui.body}>{item.text}</Text></View>)}
        <View style={{ gap: 12 }}><Text style={ui.label}>{onsite ? '在这里，接一句' : '离开现场，也能接着聊'}</Text><AlignedTextInput value={draft} onChangeText={setDraft} multiline maxLength={300} placeholder="有什么想接着说的？" placeholderTextColor={colors.muted} style={[ui.input, styles.composer]} textAlignVertical="top" accessibilityLabel="接话内容" />
          <View style={styles.placeMeta}><Text style={ui.muted}>{draft.length} / 300</Text><Text style={ui.muted}>匿名 · 仅保存在本机</Text></View>
          <Action title="发送接话" disabled={!draft.trim()} onPress={() => { store.reply(place.id, draft, fix); setDraft(''); }} /></View>
      </>}
      <Action secondary title="回到发现" onPress={() => router.replace('/')} />
      {!point && <Text style={ui.muted}>演示数据仅用于体验，不对应真实校园留言。首次在现场接话后，该对话会进入「消息」。</Text>}
    </KeyboardAlignedScrollView>;
}
const styles = StyleSheet.create({
  placeMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  photo: { width: '100%', height: 250, borderRadius: 14, backgroundColor: '#101613' },
  originalText: { fontSize: 25, lineHeight: 37, fontWeight: '600' },
  engagement: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  author: { flex: 1, minWidth: 0 },
  bookmark: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  locationSection: { gap: 8 },
  like: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingVertical: 6, paddingRight: 16 },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  myReply: { borderLeftWidth: 2, borderLeftColor: '#9bae8b' },
  composer: { minHeight: 110 },
});
