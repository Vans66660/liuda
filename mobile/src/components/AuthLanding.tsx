import { useState } from 'react';
import { useFonts } from 'expo-font';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AnimatedLogo } from './AnimatedLogo';
import { AlignedTextInput, KeyboardAlignedSheet } from './KeyboardAlignedScrollView';
import { router, usePathname } from 'expo-router';
import { useEntry } from '../state/entry';
import { verifyInviteCode } from '../api/invite';

type LoginMethod = '手机号' | 'Apple';

export function AuthLanding() {
  const { started, notice } = useEntry();
  const [fontsLoaded] = useFonts({
    LiudaDisplay: require('../../assets/fonts/LiudaDisplay.otf'),
    LiudaInterfaceV2: require('../../assets/fonts/LiudaInterfaceV2.otf'),
    LiudaInterfaceMedium: require('../../assets/fonts/LiudaInterfaceMedium.otf'),
  });
  const regular = fontsLoaded ? s.interfaceFont : undefined;
  const medium = fontsLoaded ? s.mediumFont : undefined;
  const pathname = usePathname();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = height - insets.top - insets.bottom < 650;
  const [method, setMethod] = useState<LoginMethod>('手机号');
  const [loginOpen, setLoginOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');

  function browse() {
    setLoginOpen(false);
    setInviteOpen(false);
    router.replace(started ? '/discover' : '/onboarding');
  }

  async function submitInvite() {
    if (inviteBusy) return;
    setInviteBusy(true);
    setInviteError('');
    const result = await verifyInviteCode(inviteCode);
    setInviteBusy(false);
    if (!result.ok) {
      setInviteError(result.message);
      return;
    }
    browse();
  }

  function openInvite() {
    setInviteCode('');
    setInviteError('');
    setInviteOpen(true);
  }

  return <SafeAreaView style={s.screen}>
    <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
      <View style={[s.identity, compact && s.identityCompact]}>
        <AnimatedLogo size={compact ? 172 : 220} active={!loginOpen && !inviteOpen && (pathname === '/welcome' || pathname === '/login')} />
        <Text accessibilityRole="header" style={[s.name, fontsLoaded && s.displayFont]}>留答</Text>
        <Text style={[s.tagline, regular]}>到哪都有人陪着你</Text>
      </View>
      <View style={s.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="手机号登录" onPress={() => { setMethod('手机号'); setLoginOpen(true); }} style={({ pressed }) => [s.method, s.primary, pressed && s.pressed]}>
          <Ionicons name="logo-wechat" size={22} color="#111" style={s.methodIcon} /><Text style={[s.primaryText, medium]}>手机号登录</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="通过 Apple 登录" onPress={() => { setMethod('Apple'); setLoginOpen(true); }} style={({ pressed }) => [s.method, s.secondary, pressed && s.pressed]}>
          <Ionicons name="logo-apple" size={22} color="#eee" style={s.methodIcon} /><Text style={[s.secondaryText, medium]}>通过 Apple 登录</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="使用团队邀请码" onPress={openInvite} style={({ pressed }) => [s.method, s.inviteButton, pressed && s.pressed]}>
          <Ionicons name="key-outline" size={20} color="#d5e6bb" style={s.methodIcon} /><Text style={[s.inviteButtonText, medium]}>使用团队邀请码</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={browse} style={({ pressed }) => [s.guest, pressed && s.pressed]}><Text style={[s.guestText, regular]}>先逛逛</Text></Pressable>
      </View>
      <Pressable accessibilityRole="link" onPress={() => router.push('/about-privacy')} style={s.privacy}><Text style={[s.privacyText, regular]}>隐私说明</Text></Pressable>
      {!!notice && <Text style={[s.notice, regular]}>{notice}</Text>}
    </ScrollView>

    <Modal visible={loginOpen} transparent animationType="fade" onRequestClose={() => setLoginOpen(false)}>
      <View style={s.modalBackground}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭登录说明" style={StyleSheet.absoluteFill} onPress={() => setLoginOpen(false)} />
        <View accessibilityViewIsModal style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={s.sheetHeader}><Text accessibilityRole="header" style={[s.sheetTitle, medium]}>{method}登录</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭登录说明" hitSlop={12} onPress={() => setLoginOpen(false)}><Ionicons name="close" size={23} color="#a1a1a1" /></Pressable></View>
          <Text style={[s.sheetBody, regular]}>账号服务尚未接入。现在可以先浏览演示内容。</Text>
          <Pressable accessibilityRole="button" onPress={browse} style={({ pressed }) => [s.method, s.primary, pressed && s.pressed]}><Text style={[s.primaryText, medium]}>先逛逛</Text></Pressable>
        </View>
      </View>
    </Modal>

    <Modal visible={inviteOpen} transparent animationType="fade" onRequestClose={() => setInviteOpen(false)}>
      <View style={s.modalBackground}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭邀请码窗口" style={StyleSheet.absoluteFill} onPress={() => setInviteOpen(false)} />
        <KeyboardAlignedSheet accessibilityViewIsModal style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <View style={s.sheetHeader}>
            <Text accessibilityRole="header" style={[s.sheetTitle, medium]}>团队邀请码</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭邀请码窗口" hitSlop={12} onPress={() => setInviteOpen(false)}><Ionicons name="close" size={23} color="#a1a1a1" /></Pressable>
          </View>
          <Text style={[s.sheetBody, regular]}>内部测试版：输入团队邀请码后进入。邀请码由云端校验，本版不含短信验证。</Text>
          <AlignedTextInput
            accessibilityLabel="邀请码输入框"
            value={inviteCode}
            onChangeText={value => { setInviteCode(value); setInviteError(''); }}
            placeholder="请输入邀请码"
            placeholderTextColor="#6f7370"
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            allowFontScaling={false}
            editable={!inviteBusy}
            style={s.inviteInput}
          />
          {!!inviteError && <Text style={s.inviteError}>{inviteError}</Text>}
          <Pressable accessibilityRole="button" disabled={inviteBusy} onPress={submitInvite} style={({ pressed }) => [s.method, s.primary, (pressed || inviteBusy) && s.pressed]}>
            <Text style={[s.primaryText, medium]}>{inviteBusy ? '校验中…' : '进入留答'}</Text>
          </Pressable>
        </KeyboardAlignedSheet>
      </View>
    </Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  displayFont: { fontFamily: 'LiudaDisplay' },
  interfaceFont: { fontFamily: 'LiudaInterfaceV2' },
  mediumFont: { fontFamily: 'LiudaInterfaceMedium' },
  screen: { flex: 1, backgroundColor: '#000' },
  content: { flexGrow: 1, paddingHorizontal: 32, paddingBottom: 12 },
  identity: { flex: 1, minHeight: 330, alignItems: 'center', justifyContent: 'center', paddingTop: 20, paddingBottom: 48 },
  identityCompact: { minHeight: 240, paddingTop: 4, paddingBottom: 26 },
  name: { color: '#ededed', fontSize: 29, lineHeight: 44, fontWeight: 'normal', letterSpacing: 8, marginTop: 6, paddingLeft: 8, includeFontPadding: false },
  tagline: { color: '#999', fontSize: 12, lineHeight: 22, letterSpacing: 1.4, marginTop: 9, paddingLeft: 1.4, includeFontPadding: false },
  actions: { gap: 12, paddingBottom: 16 },
  method: { minHeight: 54, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 14 },
  methodIcon: { position: 'absolute', left: 21 },
  primary: { backgroundColor: '#f4f4f4' },
  primaryText: { color: '#111', fontSize: 15, lineHeight: 22, fontWeight: 'normal', letterSpacing: 0.4, includeFontPadding: false },
  secondary: { backgroundColor: '#131313', borderWidth: 1, borderColor: '#242424' },
  secondaryText: { color: '#e8e8e8', fontSize: 15, lineHeight: 22, fontWeight: 'normal', letterSpacing: 0.4, includeFontPadding: false },
  inviteButton: { backgroundColor: '#1d2721', borderWidth: 1, borderColor: '#3b4a3c' },
  inviteButtonText: { color: '#d5e6bb', fontSize: 15, lineHeight: 22, fontWeight: 'normal', letterSpacing: 0.4, includeFontPadding: false },
  inviteInput: { color: '#f4f4f4', backgroundColor: '#252930', borderRadius: 14, paddingLeft: 16, paddingRight: 26, paddingVertical: 14, fontSize: 16, minHeight: 52, includeFontPadding: true },
  inviteError: { color: '#e4a5a5', fontSize: 13, lineHeight: 20, includeFontPadding: false },
  guest: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  guestText: { color: '#a0a0a0', fontSize: 13, lineHeight: 22, letterSpacing: 0.8, includeFontPadding: false },
  privacy: { minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  privacyText: { color: '#7d7d7d', fontSize: 12, lineHeight: 20, letterSpacing: 0.2, includeFontPadding: false },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
  notice: { color: '#aaa', fontSize: 12, lineHeight: 20, letterSpacing: 0.2, includeFontPadding: false, textAlign: 'center' },
  modalBackground: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 480, backgroundColor: '#191919', borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 26, gap: 22 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  sheetTitle: { fontSize: 20, fontWeight: 'normal', color: '#f4f4f4' },
  sheetBody: { color: '#aaa', fontSize: 14, lineHeight: 24, marginBottom: 4 },
});
