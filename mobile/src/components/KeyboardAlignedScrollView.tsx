import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Dimensions, Keyboard, Platform, ScrollView, TextInput, View } from 'react-native';
import type {
  KeyboardEvent, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent,
  ScrollViewInstance, ScrollViewProps, TextInputBlurEvent, TextInputFocusEvent,
  TextInputInstance, TextInputProps, ViewProps,
} from 'react-native';

// 键盘弹出时，把当前聚焦输入框的下沿滚动到键盘顶部上方 GAP 处。
// 与 KeyboardAvoidingView 的固定 keyboardVerticalOffset 不同，这里用 measureInWindow
// 读取输入框在窗口中的真实位置，所以不受页面 header、滚动位置、多行输入框高度变化影响。
const GAP = 12;
const SCROLL_HEADROOM = 32;

type AlignApi = {
  focus: (node: TextInputInstance | null) => void;
  blur: (node: TextInputInstance | null) => void;
  relayout: (node: TextInputInstance | null) => void;
};

const noop = () => {};
const AlignContext = createContext<AlignApi>({ focus: noop, blur: noop, relayout: noop });

export function KeyboardAlignedScrollView({
  children, contentContainerStyle, onScroll, keyboardShouldPersistTaps = 'handled',
  style, scrollEventThrottle = 16, ...rest
}: ScrollViewProps) {
  const scroll = useRef<ScrollViewInstance | null>(null);
  const focused = useRef<TextInputInstance | null>(null);
  const keyboardTop = useRef<number | null>(null);
  const keyboardHeight = useRef(0);
  const baseOffset = useRef(0);
  const offset = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [extraPadding, setExtraPadding] = useState(0);

  const align = useCallback(() => {
    const node = focused.current;
    if (!node || keyboardTop.current == null) return;
    node.measureInWindow((_x, y, _width, height) => {
      if (keyboardTop.current == null || !Number.isFinite(y) || !Number.isFinite(height)) return;
      // delta > 0：输入框被键盘压住，需要上移；delta < 0：输入框离键盘太远，回滚到贴合位置。
      const delta = y + height + GAP - keyboardTop.current;
      if (Math.abs(delta) < 1) return;
      const target = Math.max(baseOffset.current, offset.current + delta);
      offset.current = target;
      scroll.current?.scrollTo({ y: target, animated: true });
    });
  }, []);

  const scheduleAlign = useCallback((delay = 60) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; align(); }, delay);
  }, [align]);

  const updateKeyboard = useCallback((event: KeyboardEvent) => {
    const { endCoordinates } = event;
    if (!Number.isFinite(endCoordinates.height) || endCoordinates.height <= 0) return;
    const top = Number.isFinite(endCoordinates.screenY)
      ? endCoordinates.screenY
      : Dimensions.get('window').height - endCoordinates.height;
    if (keyboardTop.current == null) baseOffset.current = offset.current;
    keyboardTop.current = top;
    if (keyboardHeight.current !== endCoordinates.height) {
      keyboardHeight.current = endCoordinates.height;
      // 补足可滚动余量，保证即使输入框位于页面底部也能滚动到贴合位置。
      setExtraPadding(endCoordinates.height + SCROLL_HEADROOM);
    }
    scheduleAlign();
  }, [scheduleAlign]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', updateKeyboard);
    // iOS 切换输入法 / 候选栏、外接键盘时键盘高度会变化，需要重新对齐；Android 仅在 didShow 时重发。
    const frame = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidChangeFrame', updateKeyboard) : null;
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      keyboardHeight.current = 0;
      focused.current = null;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setExtraPadding(0);
    });
    return () => {
      show.remove(); frame?.remove(); hide.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [updateKeyboard]);

  const api = useMemo<AlignApi>(() => ({
    focus: node => {
      focused.current = node;
      // 键盘已经打开时切换输入框，立即按新输入框重算。
      if (keyboardTop.current != null) scheduleAlign(50);
    },
    blur: node => {
      if (focused.current !== node) return;
      // 延迟清空，避免「blur 旧框 → focus 新框」顺序把新焦点抹掉。
      setTimeout(() => { if (focused.current === node) focused.current = null; }, 0);
    },
    relayout: node => {
      // 多行输入换行、条件展开导致输入框尺寸变化时保持贴合。
      if (focused.current === node && keyboardTop.current != null) scheduleAlign(80);
    },
  }), [scheduleAlign]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
    onScroll?.(event);
  }, [onScroll]);

  return <AlignContext.Provider value={api}>
    <ScrollView
      {...rest}
      ref={scroll}
      style={[{ flex: 1 }, style]}
      contentContainerStyle={[contentContainerStyle, extraPadding > 0 ? { paddingBottom: extraPadding } : null]}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      automaticallyAdjustKeyboardInsets={false}
      onScroll={handleScroll}
      scrollEventThrottle={scrollEventThrottle}
    >
      {children}
    </ScrollView>
  </AlignContext.Provider>;
}

/** 替换 TextInput 使用：向对齐容器注册焦点与尺寸，其余 props 原样透传。 */
export function AlignedTextInput({ onFocus, onBlur, onLayout, ...props }: TextInputProps) {
  const api = useContext(AlignContext);
  const node = useRef<TextInputInstance | null>(null);
  const setNode = useCallback((value: TextInputInstance | null) => { node.current = value; }, []);
  const handleFocus = useCallback((event: TextInputFocusEvent) => {
    api.focus(node.current);
    onFocus?.(event);
  }, [api, onFocus]);
  const handleBlur = useCallback((event: TextInputBlurEvent) => {
    api.blur(node.current);
    onBlur?.(event);
  }, [api, onBlur]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    api.relayout(node.current);
    onLayout?.(event);
  }, [api, onLayout]);
  // 默认值放在 {...props} 之前，页面可按需覆盖。
  // 固定字号避免系统「更大字体」把字形撑出输入框；关闭自动更正/拼写检查减少中文组合文本与光标错位。
  return <TextInput
    allowFontScaling={false}
    autoComplete="off"
    spellCheck={false}
    autoCorrect={false}
    {...props}
    ref={setNode}
    onFocus={handleFocus} onBlur={handleBlur} onLayout={handleLayout}
  />;
}

/**
 * 底部弹出面板（Modal sheet）版本的键盘对齐容器。
 * sheet 内部没有可滚动区域，所以不靠 scrollTo，而是整体抬升面板：
 * 用 measureInWindow 读取聚焦输入框下沿，抬升到键盘上沿上方 GAP 处。
 * 与 KeyboardAlignedScrollView 共用 AlignContext / AlignedTextInput，保证全项目对齐语义一致。
 */
export function KeyboardAlignedSheet({ children, style, ...rest }: ViewProps & { children: ReactNode }) {
  const focused = useRef<TextInputInstance | null>(null);
  const keyboardTop = useRef<number | null>(null);
  const lift = useRef(0);
  const [liftValue, setLiftValue] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyLift = useCallback((next: number) => {
    const value = Math.max(0, next);
    if (Math.abs(value - lift.current) < 1) return;
    lift.current = value;
    setLiftValue(value);
  }, []);

  const align = useCallback(() => {
    const node = focused.current;
    if (!node || keyboardTop.current == null) return;
    node.measureInWindow((_x, y, _width, height) => {
      const top = keyboardTop.current;
      if (top == null || !Number.isFinite(y) || !Number.isFinite(height)) return;
      // 面板已被 transform 抬升 lift，测量值是视觉位置；加回 lift 才是未抬升时的下沿。
      const bottom = y + height + lift.current;
      applyLift(bottom + GAP - top);
    });
  }, [applyLift]);

  const scheduleAlign = useCallback((delay = 60) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; align(); }, delay);
  }, [align]);

  const updateKeyboard = useCallback((event: KeyboardEvent) => {
    const { endCoordinates } = event;
    if (!Number.isFinite(endCoordinates.height) || endCoordinates.height <= 0) return;
    const top = Number.isFinite(endCoordinates.screenY)
      ? endCoordinates.screenY
      : Dimensions.get('window').height - endCoordinates.height;
    keyboardTop.current = top;
    scheduleAlign();
  }, [scheduleAlign]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', updateKeyboard);
    // iOS 切换输入法 / 候选栏、外接键盘时高度会变，需要重新贴合；Android 仅在 didShow 重发。
    const frame = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidChangeFrame', updateKeyboard) : null;
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      focused.current = null;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      applyLift(0);
    });
    return () => {
      show.remove(); frame?.remove(); hide.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [updateKeyboard, applyLift]);

  const api = useMemo<AlignApi>(() => ({
    focus: node => {
      focused.current = node;
      if (keyboardTop.current != null) scheduleAlign(50);
    },
    blur: node => {
      if (focused.current !== node) return;
      setTimeout(() => { if (focused.current === node) focused.current = null; }, 0);
    },
    relayout: node => {
      if (focused.current === node && keyboardTop.current != null) scheduleAlign(80);
    },
  }), [scheduleAlign]);

  return <AlignContext.Provider value={api}>
    <View
      {...rest}
      style={[style, liftValue > 0 ? { transform: [{ translateY: -liftValue }] } : null]}
    >
      {children}
    </View>
  </AlignContext.Provider>;
}
