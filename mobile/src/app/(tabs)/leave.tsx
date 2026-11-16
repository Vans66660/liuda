import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AnimatedLogo } from '../../components/AnimatedLogo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AlignedTextInput, KeyboardAlignedScrollView } from '../../components/KeyboardAlignedScrollView';
import { LeaveMedia, savePlaceMedia, VoiceCapture, type MediaDraft } from '../../components/LeaveMedia';
import { router, usePathname } from 'expo-router';
import { describePosition, readPosition, readPositionIfAllowed, type PositionDescription } from '../../location/device';
import { devApiUrl } from '../../location/api';
import { atPoint, distanceMeters, usableFix, type Fix, type Point } from '../../location/geo';
import { usePlaces } from '../../state/places';
import { Action, colors, Loading, Screen, ui } from '../../components/ui';

const modes = [
  { id: 'photo', label: '拍照' },
  { id: 'voice', label: '语音' },
  { id: 'text', label: '文字' },
] as const;

function PlaceQuestion({ text, active }: { text: string; active: boolean }) {
  const [visible, setVisible] = useState(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const letters = Array.from(text);
  const done = reduceMotion === true || visible >= letters.length;

  useEffect(() => {
    let current = true;
    let changed = false;
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true;
      setReduceMotion(value);
    });
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (current && !changed) setReduceMotion(value); })
      .catch(() => { if (current && !changed) setReduceMotion(false); });
    return () => { current = false; listener.remove(); };
  }, []);

  useEffect(() => {
    if (!active || done || reduceMotion === null) return;
    const timer = setTimeout(() => setVisible(count => count + 1), visible === 0 ? 180 : 54);
    return () => clearTimeout(timer);
  }, [active, done, reduceMotion, visible]);

  return <Text style={styles.questionText} accessibilityLabel={text} onPress={() => setVisible(letters.length)}>
    {done ? text : <>
      {letters.slice(0, visible).join('')}
      <Text style={styles.unrevealed}>{letters.slice(visible).join('')}</Text>
    </>}
  </Text>;
}

export default function LeaveScreen() {
  const store = usePlaces();
  const [askedForClue, setAskedForClue] = useState(false);
  const [askLandmark, setAskLandmark] = useState(false);
  const [shopOptions, setShopOptions] = useState<{ name: string; point?: Point }[]>([]);
  const [shopPoint, setShopPoint] = useState<Point>();
  const [matchedShop, setMatchedShop] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [placeStep, setPlaceStep] = useState<'describe' | 'refine' | 'review' | 'edit'>('describe');
  const [holdingVoice, setHoldingVoice] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [locationChoice, setLocationChoice] = useState<string | null>('new');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<typeof modes[number]['id']>('photo');
  const [drafts, setDrafts] = useState<Partial<Record<MediaDraft['kind'], MediaDraft>>>({});
  const draft = mode === 'text' ? undefined : drafts[mode];
  const [confirmed, setConfirmed] = useState<{ fix: Fix; label: string }>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<{ fix: Fix; description: PositionDescription | null }>();
  const description = resolvedAddress?.fix === fix ? resolvedAddress.description : null;
  const [locating, setLocating] = useState(false);
  const [checkingLocation, setCheckingLocation] = useState(true);
  const isHere = usePathname() === '/leave';

  useEffect(() => {
    if (!isHere) return;
    let active = true;
    readPositionIfAllowed()
      .then(value => { if (active && value) setFix(current => current && current.timestamp > value.timestamp ? current : value); })
      .catch(() => {})
      .finally(() => { if (active) setCheckingLocation(false); });
    return () => { active = false; };
  }, [isHere]);

  useEffect(() => {
    if (!fix) return;
    let active = true;
    describePosition(fix).then(description => { if (active) setResolvedAddress({ fix, description }); });
    return () => { active = false; };
  }, [fix]);

  async function locate() {
    setLocating(true);
    setNotice('');
    try {
      setFix(await readPosition());
    } catch (error) {
      setFix(null);
      setNotice(error instanceof Error ? error.message : '无法获取位置，请重试。');
    } finally {
      setLocating(false);
    }
  }

  const nearby = fix ? [...new Map(store.places.flatMap(place =>
    place.customLocationId && place.point && distanceMeters(fix, place.point) <= 30
      ? [[place.customLocationId, place] as const] : []
  )).values()] : [];
  const selected = locationChoice && locationChoice !== 'new'
    ? store.places.find(place => place.customLocationId === locationChoice)
    : undefined;
  const creating = locationChoice === 'new';
  const missingName = creating && !name.trim();

  const refining = placeStep === 'refine';
  const anchorName = matchedShop || name;
  const detailQuestion = askLandmark ? '它靠窗、靠门，还是旁边有什么好认的？'
    : /咖啡|餐厅|茶|星巴克|tims|餐饮/i.test(anchorName)
    ? '你坐在店里的哪里？比如靠窗第几把椅子。'
    : /商场|购物中心|广场|创意谷/.test(anchorName)
      ? '你在几楼、哪家店或哪个入口旁？'
      : '你在里面的哪个位置？可以说说附近的座位、入口或标志。';

  async function organizePlace(requestedAt: number, voiceUri?: string) {
    const url = devApiUrl('/api/place-clue');
    const description = descriptionDraft.trim();
    if ((!description && !voiceUri) || organizing) return;
    Keyboard.dismiss();
    setNotice('');
    setOrganizing(true);
    setShopOptions([]);
    const controller = new AbortController();
    let locationTimer: ReturnType<typeof setTimeout> | undefined;
    const requestTimer = setTimeout(() => controller.abort(), 18_000);
    try {
      // A slow GPS fix should never prevent the user's recording from reaching AI.
      const currentFix = refining ? null : fix && requestedAt - fix.timestamp <= 30_000
        ? fix
        : await Promise.race([
          readPositionIfAllowed().catch(() => null),
          new Promise<null>(resolve => { locationTimer = setTimeout(() => resolve(null), 1500); }),
        ]);
      if (currentFix) setFix(currentFix);
      const searchFix = currentFix ?? (fix && requestedAt - fix.timestamp <= 120_000 ? fix : null);
      const audio = voiceUri ? await new File(voiceUri).base64() : undefined;
      const response = url && await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, audio, refining, area: namedArea, point: !refining && searchFix ? { latitude: searchFix.latitude, longitude: searchFix.longitude } : undefined }),
      });
      if (!response || !response.ok) {
        setNotice(response && response.status === 503
          ? '这个预览未启用语音整理，请打开最新的 Expo Go 预览。'
          : '暂时无法整理，可以再试一次或手动填写。');
        return;
      }
      const result = await response.json() as { name: string; clue: string; shop?: string; shops?: string[]; shopPoint?: Point; shopCandidates?: { name: string; point?: Point }[]; followUp?: 'none' | 'venue' | 'landmark' };
      if (!result.name && !result.shop) {
        if (refining) {
          setPlaceStep('review');
          setNotice('可以先用这个地点，也可以拍张现场照。');
        } else {
          setNotice(askedForClue ? '可以用当前位置继续。' : '旁边有招牌、门牌或显眼的东西吗？');
          setAskedForClue(true);
        }
        return;
      }
      if (refining) {
        const detail = result.name.trim();
        const parent = matchedShop || (askLandmark ? '' : anchorName);
        const available = 40 - detail.length - 3;
        setName(parent && available > 0 ? `${parent.slice(0, available)} · ${detail}` : detail);
        setLocation([location, result.clue].filter(Boolean).join(' · ').slice(0, 80));
        setPlaceStep('review');
        return;
      }
      setShopOptions(result.shopCandidates ?? (result.shops ?? []).map(name => ({ name })));
      setShopPoint(result.shopPoint);
      setMatchedShop(result.shop ?? '');
      const name = result.name;
      const shop = result.shop;
      const insideShop = shop && name && !shop.includes(name) && /桌|座位|窗|角落|楼层|柜台/.test(name);
      setName(shop ? (insideShop ? `${shop} · ${name}` : shop).slice(0, 40) : name);
      setLocation(result.clue);
      setDescriptionDraft('');
      setAskLandmark(result.followUp === 'landmark');
      setPlaceStep(!result.shops?.length && !askedForClue && (result.followUp === 'landmark' || (result.followUp === 'venue' && !insideShop)) ? 'refine' : 'review');
    } catch {
      setNotice('暂时无法整理，可以手动填写地点。');
    } finally {
      clearTimeout(locationTimer);
      clearTimeout(requestTimer);
      if (voiceUri) { try { new File(voiceUri).delete(); } catch {} }
      setOrganizing(false);
    }
  }

  async function confirmPlace() {
    if (missingName || confirming || locating) return;
    Keyboard.dismiss();
    setConfirming(true);
    setNotice('');
    try {
      const current = usableFix(fix) ? fix : await readPosition();
      setFix(current);
      if (!usableFix(current)) {
        setNotice('定位还不够准，请在开阔处重试。');
        return;
      }
      if (fix && !atPoint(current, fix) && !selected) {
        setNotice('位置已更新，请确认新的地点。');
        return;
      }
      if (selected?.point && !atPoint(current, selected.point)) {
        setNotice('请走近所选地点，或改用当前位置。');
        return;
      }
      setConfirmed({ fix: current, label: placeLabel });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法获取位置，请重试。');
    } finally {
      setConfirming(false);
    }
  }

  async function publish() {
    if (!confirmed || busy || missingName || (mode === 'text' ? !text.trim() : !draft)) return;
    setBusy(true);
    setNotice('');
    try {
      const fix = await readPosition();
      setFix(fix);
      if (!usableFix(fix)) {
        setNotice('定位还不够准。可以走到开阔处，再试一次。');
        return;
      }
      const onsitePoint = selected?.point ?? confirmed.fix;
      if (!atPoint(fix, onsitePoint)) {
        setNotice('你已离开确认的地点，请重新确认。');
        return;
      }
      const point = creating && shopPoint ? shopPoint : onsitePoint;
      const media = draft ? savePlaceMedia(draft) : undefined;
      const id = store.create(selected?.name ?? (creating ? name : confirmed.label === '当前位置' || confirmed.label === '选择地点' ? '' : confirmed.label), selected?.location ?? (creating ? location : ''),
        mode === 'voice' ? '' : text, { latitude: point.latitude, longitude: point.longitude },
        media, selected?.customLocationId ?? (creating ? true : undefined));
      setName(''); setLocation(''); setDescriptionDraft(''); setAskedForClue(false); setMatchedShop(''); setShopPoint(undefined); setShopOptions([]); setPlaceStep('describe'); setLocationChoice('new'); setText(''); setConfirmed(undefined); setDrafts({});
      router.push({ pathname: '/place/[id]', params: { id } });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法获取位置，请重试。');
    } finally {
      setBusy(false);
    }
  }
  function discard() {
    Object.values(drafts).forEach(value => {
      if (value?.uri) { try { new File(value.uri).delete(); } catch { /* 临时文件可能已被清理 */ } }
    });
    setName(''); setLocation(''); setDescriptionDraft(''); setAskedForClue(false);
    setAskLandmark(false); setMatchedShop(''); setShopPoint(undefined); setShopOptions([]);
    setPlaceStep('describe'); setLocationChoice('new'); setText(''); setConfirmed(undefined);
    setDrafts({}); setNotice('');
    router.navigate('/discover');
  }
  if (!store.ready) return <Loading />;
  const currentPlaceLabel = fix
    ? (fix.accuracy !== null && fix.accuracy <= 15 ? description?.building : undefined) || description?.area || (description?.landmark ? `${description.landmark}附近` : description?.address) || '当前位置'
    : '选择地点';
  const placeLabel = locating ? '定位中…'
    : selected?.name || (creating ? name.trim() || '新建地点' : currentPlaceLabel);
  const detecting = checkingLocation || (!!fix && resolvedAddress?.fix !== fix);
  const namedArea = fix && currentPlaceLabel !== '当前位置' ? currentPlaceLabel : '';
  const question = organizing ? '我在整理你说的线索…'
    : selected ? `你在「${selected.name}」吗？`
    : detecting || locating ? '正在找你的位置…'
    : creating && shopOptions.length > 0 ? '附近有几家匹配的店，你在哪一家？'
    : creating ? (refining ? (askLandmark ? detailQuestion : `是「${anchorName}」吗？${detailQuestion}`) : placeStep === 'review' ? (matchedShop && name === matchedShop ? `我找到附近的「${matchedShop}」，是这家吗？` : `我理解的是「${name}」，对吗？`) : placeStep === 'edit' ? '这里叫什么？' : namedArea ? `在「${namedArea}」附近，你旁边有什么好认的？` : '你旁边有什么好认的？')
    : namedArea ? `就留在「${namedArea}」吗？` : '就留在当前位置吗？';
  if (!confirmed) return <Screen>
    <KeyboardAlignedScrollView scrollEnabled={!holdingVoice} contentContainerStyle={[ui.content, styles.questionScreen]}>
      <View style={styles.question}>
        <AnimatedLogo size={176} active={isHere} blinkOnStart />
        <PlaceQuestion key={question} text={question} active={isHere} />
      </View>
      {creating && shopOptions.map(shop => <Pressable key={shop.name} accessibilityRole="button" style={styles.locationOption}
        onPress={() => { setMatchedShop(shop.name); setShopPoint(shop.point); setName(shop.name.slice(0, 40)); setShopOptions([]); setPlaceStep('refine'); }}>
        <Ionicons name="location-outline" size={16} color={colors.accent} />
        <Text style={ui.body}>{shop.name}</Text>
      </Pressable>)}
      {creating && shopOptions.length === 0 && (placeStep === 'describe' || refining) && <>
        {isHere && Platform.OS !== 'web' && !organizing && <VoiceCapture forPlace onHoldChange={setHoldingVoice}
          onCapture={draft => { void organizePlace(Date.now(), draft.uri); }} onError={setNotice} />}
        <AlignedTextInput value={descriptionDraft} onChangeText={setDescriptionDraft} maxLength={160}
          editable={!organizing} placeholder={refining ? '比如：靠窗第二把椅子' : '比如：电梯右边有台红色售货机'}
          placeholderTextColor={colors.muted} style={ui.input} accessibilityLabel="现场描述，可用键盘听写" />
        <Action title={organizing ? '整理中…' : (refining ? '补充这个位置' : '帮我整理')} disabled={organizing || !descriptionDraft.trim()} onPress={() => { void organizePlace(Date.now()); }} />
        <Pressable accessibilityRole="button" disabled={organizing} style={styles.secondaryReply}
          onPress={() => { if (!refining) setName(descriptionDraft.trim().slice(0, 40)); setPlaceStep('edit'); setNotice(''); }}>
          <Text style={styles.secondaryReplyText}>手动填写</Text>
        </Pressable>
      </>}
      {creating && placeStep === 'review' && matchedShop && name !== matchedShop && <Text style={[ui.muted, { textAlign: 'center' }]}>{matchedShop}</Text>}
      {creating && placeStep === 'review' && location ? <Text style={[ui.muted, { textAlign: 'center' }]}>{location}</Text> : null}
      {creating && placeStep === 'edit' && <>
        <AlignedTextInput value={name} onChangeText={value => { setName(value); setShopPoint(undefined); setMatchedShop(''); }} maxLength={40} editable={!confirming}
          placeholder="比如：二楼靠窗第三张桌子" placeholderTextColor={colors.muted} style={ui.input} accessibilityLabel="新地点名称" />
        <AlignedTextInput value={location} onChangeText={setLocation} maxLength={80} editable={!confirming}
          placeholder="怎么找到这里（选填）" placeholderTextColor={colors.muted} style={ui.input} accessibilityLabel="现场线索" />
      </>}
      {(!creating || (shopOptions.length === 0 && placeStep !== 'describe')) && <Action title={confirming ? '确认中…' : creating ? (refining ? '就用这个地点' : placeStep === 'review' ? '就是这里' : '确认这个地点') : detecting || locating ? '定位中…' : fix ? '就在这里' : '获取位置'}
        disabled={organizing || confirming || locating || missingName || (!creating && detecting)}
        onPress={creating || fix ? confirmPlace : locate} />}
      {creating && shopOptions.length === 0 && placeStep === 'review' && <Pressable accessibilityRole="button" disabled={confirming} style={styles.secondaryReply}
        onPress={() => { setAskLandmark(false); setDescriptionDraft(''); setNotice(''); setPlaceStep('refine'); }}>
        <Text style={styles.secondaryReplyText}>再补一句</Text>
      </Pressable>}
      {creating && shopOptions.length === 0 && placeStep === 'review' && <Pressable accessibilityRole="button" disabled={confirming} style={styles.secondaryReply}
        onPress={() => setPlaceStep('edit')}>
        <Text style={styles.secondaryReplyText}>改一下</Text>
      </Pressable>}
      <Pressable accessibilityRole="button" disabled={organizing || confirming || locating} style={styles.secondaryReply}
        onPress={() => { setShopOptions([]); setLocationChoice(creating ? null : 'new'); setNotice(''); }}>
        <Text style={styles.secondaryReplyText}>{creating ? (namedArea ? `就用「${namedArea}」` : '就用当前位置') : '创建具体地点'}</Text>
      </Pressable>
      {!selected && nearby.length > 0 && <Text style={ui.muted}>附近已创建的地点</Text>}
      {!selected && nearby.map(place => <Pressable key={place.customLocationId} accessibilityRole="button"
        disabled={organizing || confirming || locating} onPress={() => { setLocationChoice(place.customLocationId!); setNotice(''); }} style={styles.locationOption}>
        <Ionicons name="location-outline" size={16} color={colors.accent} />
        <Text style={ui.body}>{place.name}</Text>
      </Pressable>)}
      {notice ? <Text accessibilityLiveRegion="polite" style={ui.muted}>{notice}</Text> : null}
      <Pressable accessibilityRole="button" disabled={organizing || confirming || locating} accessibilityLabel="放弃这条留话" onPress={discard} style={styles.secondaryReply}>
        <Text style={styles.secondaryReplyText}>放弃这条留话</Text>
      </Pressable>
    </KeyboardAlignedScrollView>
  </Screen>;

  return <Screen><KeyboardAlignedScrollView contentContainerStyle={[ui.content, styles.content]}>
    <Pressable accessibilityRole="button" accessibilityLabel="重新确认地点" onPress={() => { setConfirmed(undefined); setNotice(''); }} disabled={busy} style={styles.location}>
      <Ionicons name="location-outline" size={16} color={colors.accent} />
      <Text style={styles.locationName} numberOfLines={1}>{confirmed.label === '选择地点' ? '当前位置' : confirmed.label}</Text>
      <Ionicons name="pencil-outline" size={14} color={colors.muted} />
    </Pressable>
    {mode === 'text' ? <View style={styles.textStage}>
      <AlignedTextInput value={text} onChangeText={setText} multiline maxLength={300} placeholder="给后来的人留句话……" placeholderTextColor={colors.muted} style={styles.editor} textAlignVertical="top" accessibilityLabel="留话内容" />
      <Text style={[ui.muted, styles.counter]}>{text.length} / 300</Text>
    </View> : <LeaveMedia key={mode} kind={mode} draft={draft} focused={isHere} onError={setNotice}
      onCapture={value => setDrafts(current => ({ ...current, [value.kind]: value }))}
      onReset={() => setDrafts(current => ({ ...current, [mode]: undefined }))} />}
    {mode === 'photo' && draft && <View style={styles.caption}>
      <AlignedTextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={300}
        editable={!busy}
        placeholder="给这张照片留句话（选填）"
        placeholderTextColor={colors.muted}
        style={[ui.input, styles.captionInput]}
        textAlignVertical="top"
        accessibilityLabel="照片配文"
      />
      <Text style={[ui.muted, styles.counter]}>{text.length} / 300</Text>
    </View>}
    <View style={styles.modes}>
      {modes.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: mode === option.id }}
        disabled={busy} onPress={() => { setMode(option.id); setNotice(''); }} style={[styles.mode, mode === option.id && styles.selectedMode]}>
        <Text style={[styles.modeText, mode === option.id && styles.selectedText]}>{option.label}</Text>
      </Pressable>)}
    </View>
    {notice ? <Text accessibilityLiveRegion="polite" style={ui.muted}>{notice}</Text> : null}
    <Action title={busy ? '正在确认现场位置…' : '留在这里'} disabled={busy || locating || missingName || (mode === 'text' ? !text.trim() : !draft)} onPress={publish} />
    <Pressable accessibilityRole="button" disabled={busy} accessibilityLabel="放弃这条留话" onPress={discard} style={styles.secondaryReply}>
      <Text style={styles.secondaryReplyText}>放弃这条留话</Text>
    </Pressable>
  </KeyboardAlignedScrollView></Screen>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 12 },
  questionScreen: { flexGrow: 1, justifyContent: 'center', gap: 12 },
  question: { alignItems: 'center', gap: 12, marginBottom: 18 },
  questionText: { color: colors.text, textAlign: 'center', fontSize: 24, lineHeight: 34, fontWeight: '600' },
  unrevealed: { color: 'transparent' },
  secondaryReply: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  secondaryReplyText: { color: colors.muted, fontSize: 14 },
  location: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, minHeight: 44, borderRadius: 22, backgroundColor: colors.surface, flexShrink: 1 },
  locationName: { color: colors.accent, fontSize: 13, flexShrink: 1 },
  locationOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  textStage: { minHeight: 280, flex: 1, borderRadius: 26, backgroundColor: '#19241f', padding: 18 },
  editor: { flex: 1, minHeight: 180, color: colors.text, fontSize: 21, lineHeight: 30 },
  caption: { gap: 4 },
  captionInput: { minHeight: 66 },
  counter: { textAlign: 'right' },
  modes: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 8, padding: 4, borderRadius: 26, backgroundColor: colors.surface },
  mode: { paddingHorizontal: 15, minHeight: 44, justifyContent: 'center', borderRadius: 22 },
  selectedMode: { backgroundColor: colors.accent },
  modeText: { color: colors.muted, fontSize: 13 },
  selectedText: { color: '#151a16', fontWeight: '600' },
});
