import { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from './ui';

export type MediaDraft = { kind: 'photo' | 'voice'; uri: string };
export type PlaceMedia = { kind: MediaDraft['kind']; file: string };

export function savePlaceMedia({ kind, uri }: MediaDraft): PlaceMedia {
  const file = `leave-${Date.now()}-${Math.random().toString(36).slice(2)}.${kind === 'photo' ? 'jpg' : 'm4a'}`;
  new File(uri).copy(new File(Paths.document, file));
  return { kind, file };
}

export function placeMediaUri(media: PlaceMedia) {
  return new File(Paths.document, media.file).uri;
}

export function VoicePlayback({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  async function toggle() {
    if (status.playing) {
      player.pause();
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) await player.seekTo(0);
      player.play();
    } catch {
      // The playback control stays available for a retry.
    }
  }
  return <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? '暂停语音' : '播放语音'} onPress={toggle} style={styles.playback}>
    <Ionicons name={status.playing ? 'pause' : 'play'} size={22} color={colors.accent} />
    <View style={styles.wave} accessible={false}>
      {[8, 15, 24, 14, 30, 20, 10, 23, 29, 13, 20, 9].map((height, index) => <View key={index} style={[styles.bar, { height }]} />)}
    </View>
    <Text style={styles.small}>{Math.floor(status.playing ? status.currentTime : status.duration)} 秒</Text>
  </Pressable>;
}

export function CaptureButton({ icon, label, onPress, disabled }: {
  icon: 'camera' | 'mic' | 'stop'; label: string; onPress: () => void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.shutter, (pressed || disabled) && styles.dim]}>
    <View style={[styles.shutterCore, icon === 'stop' && styles.recording]}>
      <Ionicons name={icon} size={26} color="#151a16" />
    </View>
  </Pressable>;
}

type CaptureProps = { onCapture: (draft: MediaDraft) => void; onError: (message: string) => void };

function PhotoCapture({ onCapture, onError }: CaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  async function capture() {
    setBusy(true);
    try {
      onError('');
      if (!permission?.granted) {
        if (!(await requestPermission()).granted) onError('请在系统设置中允许留答使用相机。');
        return;
      }
      const photo = await camera.current?.takePictureAsync({ quality: 0.65 });
      if (photo) onCapture({ kind: 'photo', uri: photo.uri });
    } catch {
      onError('拍照失败，请再试一次。');
    } finally {
      setBusy(false);
    }
  }
  return <>
    {permission?.granted
      ? <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} onMountError={() => onError('相机暂时不可用。')} />
      : <Text style={styles.prompt}>拍下眼前这一刻</Text>}
    <View pointerEvents="none" style={styles.framing}>
      <View style={[styles.corner, styles.topLeft]} />
      <View style={[styles.corner, styles.topRight]} />
      <View style={[styles.corner, styles.bottomLeft]} />
      <View style={[styles.corner, styles.bottomRight]} />
    </View>
    <View style={styles.controls}>
      <CaptureButton icon="camera" label={permission?.granted ? '拍照' : '开启相机'} disabled={busy || (permission?.granted && !ready)} onPress={capture} />
      {!permission?.granted && <Text style={styles.small}>开启相机</Text>}
    </View>
  </>;
}

function VoiceCapture({ onCapture, onError }: CaptureProps) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 250);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef(false);
  const running = useRef(false);
  const hold = useRef<{ startY: number; cancelled: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      hold.current = null;
      clearTimeout(timer.current);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, []);

  async function finish(cancelled: boolean) {
    if (!running.current) return;
    running.current = false;
    clearTimeout(timer.current);
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return;
      if (cancelled || !active.current) {
        try { new File(uri).delete(); } catch {}
      } else {
        onCapture({ kind: 'voice', uri });
      }
    } catch {
      if (active.current && !cancelled) onError('录音未能保存，请重试。');
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function start(gesture: NonNullable<typeof hold.current>) {
    setBusy(true);
    try {
      onError('');
      const permission = await AudioModule.getRecordingPermissionsAsync();
      if (hold.current !== gesture) return;
      if (!permission.granted) {
        hold.current = null;
        const result = await AudioModule.requestRecordingPermissionsAsync();
        if (active.current) onError(result.granted ? '按住按钮开始说话。' : '请在系统设置中允许留答使用麦克风。');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (hold.current !== gesture) return;
      await recorder.prepareToRecordAsync();
      if (!active.current) return;
      if (hold.current !== gesture) {
        await recorder.stop().catch(() => {});
        return;
      }
      recorder.record();
      running.current = true;
      timer.current = setTimeout(() => release(gesture.cancelled), 30_000);
    } catch {
      if (active.current && hold.current === gesture) onError('录音暂时不可用，请重试。');
    } finally {
      if (active.current) setBusy(false);
    }
  }

  function move(y: number) {
    const gesture = hold.current;
    if (!gesture) return;
    const cancelled = gesture.startY - y >= 56;
    if (gesture.cancelled === cancelled) return;
    gesture.cancelled = cancelled;
    setCancelling(cancelled);
  }

  function release(cancelled: boolean) {
    hold.current = null;
    setCancelling(false);
    void finish(cancelled);
  }

  return <>
    <Text style={[styles.prompt, cancelling && styles.cancelText]}>
      {cancelling ? '松手取消' : recording.isRecording ? `00:${String(Math.floor(recording.durationMillis / 1000)).padStart(2, '0')}` : '留一段声音'}
    </Text>
    <View style={styles.controls}>
      <View
        accessible accessibilityRole="button" accessibilityLabel="按住说话，上滑取消"
        onStartShouldSetResponder={() => !busy && !running.current && !hold.current}
        onResponderGrant={event => {
          const gesture = { startY: event.nativeEvent.pageY, cancelled: false };
          hold.current = gesture;
          void start(gesture);
        }}
        onResponderMove={event => move(event.nativeEvent.pageY)}
        onResponderRelease={event => {
          move(event.nativeEvent.pageY);
          release(hold.current?.cancelled ?? true);
        }}
        onResponderTerminationRequest={() => false}
        onResponderTerminate={() => release(true)}
        style={styles.shutter}
      >
        <View style={[styles.shutterCore, recording.isRecording && styles.recording, cancelling && styles.cancelled]}>
          <Ionicons name={cancelling ? 'close' : 'mic'} size={26} color="#151a16" />
        </View>
      </View>
      <Text style={styles.small}>{cancelling ? '下滑可恢复' : recording.isRecording ? '松手保存 · 上滑取消' : '按住说话'}</Text>
    </View>
  </>;
}

export function LeaveMedia({ kind, draft, focused, onCapture, onError, onReset }: CaptureProps & {
  kind: MediaDraft['kind']; draft?: MediaDraft; focused: boolean; onReset: () => void;
}) {
  if (!focused) return <View style={styles.stage} />;
  if (Platform.OS === 'web') return <View style={styles.stage}><Text style={styles.prompt}>请在手机上体验{kind === 'photo' ? '拍照' : '录音'}</Text></View>;
  return <View style={styles.stage}>
    {draft ? <>
      {draft.kind === 'photo'
        ? <Image source={{ uri: draft.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="现场照片预览" />
        : <VoicePlayback uri={draft.uri} />}
      <Pressable accessibilityRole="button" onPress={onReset} style={styles.reset}><Text style={styles.small}>{kind === 'photo' ? '重拍' : '重录'}</Text></Pressable>
    </> : kind === 'photo' ? <PhotoCapture onCapture={onCapture} onError={onError} /> : <VoiceCapture onCapture={onCapture} onError={onError} />}
  </View>;
}

const styles = StyleSheet.create({
  stage: { minHeight: 280, flex: 1, borderRadius: 26, overflow: 'hidden', backgroundColor: '#19241f', borderWidth: StyleSheet.hairlineWidth, borderColor: '#36473e', alignItems: 'center', justifyContent: 'center', padding: 16 },
  prompt: { color: colors.text, fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 48 },
  framing: { position: 'absolute', top: 22, left: 22, right: 22, bottom: 108 },
  corner: { position: 'absolute', width: 18, height: 18, borderColor: '#edf6d8aa' },
  topLeft: { top: 0, left: 0, borderTopWidth: 1.5, borderLeftWidth: 1.5 },
  topRight: { top: 0, right: 0, borderTopWidth: 1.5, borderRightWidth: 1.5 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 1.5, borderRightWidth: 1.5 },
  controls: { position: 'absolute', alignItems: 'center', bottom: 16, gap: 4 },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 2, borderColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  shutterCore: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  recording: { backgroundColor: '#e39d87' },
  cancelled: { backgroundColor: '#f39891' },
  cancelText: { color: '#f39891' },
  dim: { opacity: 0.55 },
  small: { fontSize: 13, color: colors.text },
  reset: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 22, backgroundColor: '#101215e8' },
  playback: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 48 },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  bar: { width: 3, borderRadius: 2, backgroundColor: colors.accent, opacity: 0.75 },
});
