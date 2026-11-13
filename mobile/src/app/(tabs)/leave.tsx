import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AlignedTextInput, KeyboardAlignedScrollView } from '../../components/KeyboardAlignedScrollView';
import { LeaveMedia, savePlaceMedia, type MediaDraft } from '../../components/LeaveMedia';
import { router, usePathname } from 'expo-router';
import { describePosition, readPosition, readPositionIfAllowed, type PositionDescription } from '../../location/device';
import { usableFix, type Fix } from '../../location/geo';
import { usePlaces } from '../../state/places';
import { Action, colors, Loading, Screen, ui } from '../../components/ui';

const modes = [
  { id: 'photo', label: '拍照' },
  { id: 'voice', label: '语音' },
  { id: 'text', label: '文字' },
] as const;

export default function LeaveScreen() {
  const store = usePlaces();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [text, setText] = useState('');
  const [mode, setMode] = useState<typeof modes[number]['id']>('photo');
  const [drafts, setDrafts] = useState<Partial<Record<MediaDraft['kind'], MediaDraft>>>({});
  const draft = mode === 'text' ? undefined : drafts[mode];
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<{ fix: Fix; description: PositionDescription | null }>();
  const description = resolvedAddress?.fix === fix ? resolvedAddress.description : null;
  const [locating, setLocating] = useState(false);
  const isHere = usePathname() === '/leave';

  useEffect(() => {
    if (!isHere) return;
    let active = true;
    readPositionIfAllowed()
      .then(value => { if (active && value) setFix(current => current && current.timestamp > value.timestamp ? current : value); })
      .catch(() => {});
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

  async function publish() {
    if (busy || (mode === 'text' ? !text.trim() : !draft)) return;
    setBusy(true);
    setNotice('');
    try {
      const fix = await readPosition();
      setFix(fix);
      if (!usableFix(fix)) {
        setNotice('定位还不够准。可以走到开阔处，再试一次。');
        return;
      }
      const media = draft ? savePlaceMedia(draft) : undefined;
      const id = store.create(name, location, mode === 'text' ? text : '', { latitude: fix.latitude, longitude: fix.longitude }, media);
      setName(''); setLocation(''); setText(''); setDetailsOpen(false); setDrafts({});
      router.push({ pathname: '/place/[id]', params: { id } });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法获取位置，请重试。');
    } finally {
      setBusy(false);
    }
  }
  if (!store.ready) return <Loading />;
  const placeLabel = locating ? '定位中…' : fix
    ? name.trim() || description?.area || description?.landmark || description?.address || '当前位置'
    : '获取当前位置';
  return <Screen><KeyboardAlignedScrollView contentContainerStyle={[ui.content, styles.content]}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => fix ? setDetailsOpen(open => !open) : void locate()} disabled={busy || locating} style={styles.location}>
        <Ionicons name="location-outline" size={16} color={colors.accent} />
        <Text style={styles.locationName} numberOfLines={1}>{placeLabel}</Text>
        <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.muted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="补充地点线索" onPress={() => setDetailsOpen(open => !open)} disabled={busy} style={styles.locationEdit}>
        <Ionicons name="options-outline" size={20} color={colors.text} />
      </Pressable>
    </View>
    {detailsOpen && <View style={styles.details}>
      <View style={styles.header}>
        <Text style={ui.muted}>{fix?.accuracy != null ? `定位误差约 ${Math.round(fix.accuracy)} 米` : '等待定位'}</Text>
        <Pressable accessibilityRole="button" disabled={busy || locating} onPress={locate}><Text style={styles.locationName}>刷新定位</Text></Pressable>
      </View>
      <AlignedTextInput value={name} onChangeText={setName} maxLength={40} placeholder="地点名（选填）" placeholderTextColor={colors.muted} style={ui.input} accessibilityLabel="地点名" />
      <AlignedTextInput value={location} onChangeText={setLocation} maxLength={80} placeholder="怎么找到这里（选填）" placeholderTextColor={colors.muted} style={ui.input} accessibilityLabel="现场线索" />
    </View>}
    {mode === 'text' ? <View style={styles.textStage}>
      <AlignedTextInput value={text} onChangeText={setText} multiline maxLength={300} placeholder="给后来的人留句话……" placeholderTextColor={colors.muted} style={styles.editor} textAlignVertical="top" accessibilityLabel="留话内容" />
      <Text style={[ui.muted, styles.counter]}>{text.length} / 300</Text>
    </View> : <LeaveMedia key={mode} kind={mode} draft={draft} focused={isHere} onError={setNotice}
      onCapture={value => setDrafts(current => ({ ...current, [value.kind]: value }))}
      onReset={() => setDrafts(current => ({ ...current, [mode]: undefined }))} />}
    <View style={styles.modes}>
      {modes.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: mode === option.id }}
        disabled={busy} onPress={() => { setMode(option.id); setNotice(''); }} style={[styles.mode, mode === option.id && styles.selectedMode]}>
        <Text style={[styles.modeText, mode === option.id && styles.selectedText]}>{option.label}</Text>
      </Pressable>)}
    </View>
    {notice ? <Text accessibilityLiveRegion="polite" style={ui.muted}>{notice}</Text> : null}
    <Action title={busy ? '正在确认现场位置…' : '留在这里'} disabled={busy || locating || (mode === 'text' ? !text.trim() : !draft)} onPress={publish} />
  </KeyboardAlignedScrollView></Screen>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, minHeight: 44, borderRadius: 22, backgroundColor: colors.surface, flexShrink: 1 },
  locationName: { color: colors.accent, fontSize: 13, flexShrink: 1 },
  locationEdit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  details: { gap: 8, paddingBottom: 4 },
  textStage: { minHeight: 280, flex: 1, borderRadius: 26, backgroundColor: '#19241f', padding: 18 },
  editor: { flex: 1, minHeight: 180, color: colors.text, fontSize: 21, lineHeight: 30 },
  counter: { textAlign: 'right' },
  modes: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 8, padding: 4, borderRadius: 26, backgroundColor: colors.surface },
  mode: { paddingHorizontal: 15, minHeight: 44, justifyContent: 'center', borderRadius: 22 },
  selectedMode: { backgroundColor: colors.accent },
  modeText: { color: colors.muted, fontSize: 13 },
  selectedText: { color: '#151a16', fontWeight: '600' },
});
