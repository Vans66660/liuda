import { placeMediaUri, VoicePlayback } from '../../components/LeaveMedia';
import { useCallback, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlignedTextInput, KeyboardAlignedScrollView } from '../../components/KeyboardAlignedScrollView';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const { ready: profileReady } = useProfile();
  const [position, setPosition] = useState<{ id: string; fix: Fix | null }>();
  const updatePosition = useCallback((fix: Fix | null) => setPosition({ id, fix }), [id]);
  const [draft, setDraft] = useState('');
  const [overlay, setOverlay] = useState<'photo' | 'reply' | null>(null);
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
  const photoUri = unlocked && place.media?.kind === 'photo' ? placeMediaUri(place.media) : undefined;
  const closeOverlay = () => setOverlay(null);
  return <View style={ui.screen}>
    <KeyboardAlignedScrollView contentContainerStyle={[ui.content, styles.content]}>
      <View style={styles.locationSection}>
        {point
          ? <LivePlacePosition key={place.id} point={point} onFix={updatePosition} />
          : <>
            <PlaceMiniMap distance={place.distance} onsite={onsite} location={place.location} />
            <Action secondary title={onsite ? '模拟离开现场' : '模拟走近并到场'} onPress={() => onsite ? store.depart(place.id) : store.arrive(place.id)} />
          </>}
        {point && locationClue ? <Text style={ui.muted}>{locationClue}</Text> : null}
      </View>
      <View style={styles.story}>
        {photoUri && <Pressable accessibilityRole="button" accessibilityLabel="查看原图" onPress={() => setOverlay('photo')}>
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
        </Pressable>}
        {unlocked && place.media?.kind === 'voice' && <VoicePlayback uri={placeMediaUri(place.media)} />}
        {(!unlocked || place.text) ? <Text style={styles.originalText}>{unlocked ? place.text : place.teaser}</Text> : null}
        <View style={styles.engagement}>
          <View style={styles.author}><Author mine={place.owned} original={!place.owned} /></View>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !onsite, selected: place.liked }} disabled={!onsite} onPress={() => store.like(place.id, fix)} accessibilityLabel={onsite ? (place.liked ? '取消点赞' : '点赞') : '点赞需到场'} style={styles.like}>
            <Ionicons name={place.liked ? 'heart' : 'heart-outline'} size={19} color={place.liked ? '#e5b9a9' : palette.soft} />
            <Text style={{ color: palette.soft }}>{place.likes}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={store.saved.includes(place.id) ? '取消想去' : '标记想去'} onPress={() => store.save(place.id)} style={styles.bookmark}>
            <Ionicons name={store.saved.includes(place.id) ? 'bookmark' : 'bookmark-outline'} size={20} color={palette.soft} />
          </Pressable>
        </View>
      </View>
      {!unlocked && <Text style={ui.muted}>到场后解锁</Text>}
      {place.task && <View style={ui.panel}><Pressable onPress={() => setTaskOpen(!taskOpen)} style={styles.placeMeta}><Text style={[ui.body, { flex: 1 }]}>⚑ {place.task.title}</Text><Text style={{ color: colors.accent }}>¥{place.task.reward} · 演示</Text><Ionicons name={taskOpen ? 'chevron-up' : 'chevron-down'} size={17} color={colors.muted} /></Pressable>{taskOpen && <Text style={ui.muted}>{place.task.requirement} 此版本不支持任务提交、支付或提现。</Text>}</View>}
      {unlocked && <View style={styles.replies}>
        <View style={styles.placeMeta}>
          <Text style={styles.sectionTitle}>接话</Text>
          <Text style={ui.muted}>{place.replies.length} 句</Text>
        </View>
        {place.replies.length === 0
          ? <Text style={ui.muted}>还没人接话</Text>
          : place.replies.map(item => <View key={item.id} style={styles.reply}>
              <Author mine={item.mine} original={item.mine && place.owned} />
              <Text style={ui.body}>{item.text}</Text>
            </View>)}
      </View>}
    </KeyboardAlignedScrollView>
    {unlocked && <View style={[styles.footer, { paddingBottom: Math.max(10, insets.bottom) }]}>
      <Action title={onsite ? '接一句' : '继续接话'} onPress={() => setOverlay('reply')} />
    </View>}
    {photoUri && overlay === 'photo' && <Modal visible animationType="fade" onRequestClose={closeOverlay}>
      <View style={styles.viewer}>
        <Image source={{ uri: photoUri }} style={styles.fullPhoto} resizeMode="contain" accessibilityLabel="现场照片原图" />
        <Pressable accessibilityRole="button" accessibilityLabel="关闭照片" onPress={closeOverlay} style={[styles.viewerClose, { top: insets.top + 8 }]}>
          <Ionicons name="close" size={25} color={colors.text} />
        </Pressable>
      </View>
    </Modal>}
    {unlocked && overlay === 'reply' && <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={closeOverlay}>
      <KeyboardAlignedScrollView style={ui.screen} contentContainerStyle={ui.content}>
        <View style={styles.placeMeta}>
          <Text style={styles.sectionTitle}>接话</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭接话" onPress={closeOverlay} style={styles.bookmark}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <AlignedTextInput autoFocus value={draft} onChangeText={setDraft} multiline maxLength={300}
          placeholder="接一句…" placeholderTextColor={colors.muted} style={[ui.input, styles.composer]}
          textAlignVertical="top" accessibilityLabel="接话内容" />
        <Action title="发送" disabled={!draft.trim()} onPress={() => {
          if (!place.participated && !(point ? atPoint(fix, point) : onsite)) return;
          store.reply(place.id, draft, fix);
          setDraft('');
          closeOverlay();
        }} />
      </KeyboardAlignedScrollView>
    </Modal>}
  </View>;

}
const styles = StyleSheet.create({
  placeMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  content: { gap: 18 },
  story: { gap: 8 },
  photo: { width: '100%', aspectRatio: 1.65, borderRadius: 16, backgroundColor: colors.surface },
  originalText: { color: colors.text, fontSize: 18, lineHeight: 28 },
  footer: { paddingHorizontal: 20, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  replies: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 14 },
  reply: { gap: 6, paddingVertical: 8 },
  viewer: { flex: 1, backgroundColor: '#080909' },
  fullPhoto: { width: '100%', height: '100%' },
  viewerClose: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: '#101215dd', alignItems: 'center', justifyContent: 'center' },
  engagement: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  author: { flex: 1, minWidth: 0 },
  bookmark: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  locationSection: { gap: 8 },
  like: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingVertical: 6, paddingRight: 16 },
  sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  composer: { minHeight: 110 },
});
