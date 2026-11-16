import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Image, Pressable, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';

const logo = require('../../assets/liuda-comma-transparent.png');
const sourceSize = 1254;
// Pixel bounds of the two eyes in the original artwork. The artwork remains unchanged.
const eyes = [
  { x: 573, y: 555, width: 68, height: 99, colors: ['#e9e8e7', '#e1e0e0', '#d9d7d8'] as const },
  { x: 758, y: 500, width: 73, height: 111, colors: ['#f5f4f4', '#efeeee', '#ebebeb'] as const },
];

export function AnimatedLogo({ size, active, blinkOnStart = false }: { size: number; active: boolean; blinkOnStart?: boolean }) {
  const glowId = useId().replace(/:/g, '');
  const [imageReady, setImageReady] = useState(false);
  const [float] = useState(() => new Animated.Value(0));
  const [blink] = useState(() => new Animated.Value(0));
  const blinkAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [reduceMotion, setReduceMotion] = useState(true);
  const enabled = active && foreground && !reduceMotion;

  useEffect(() => {
    let mounted = true;
    let preferenceChanged = false;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted && !preferenceChanged) setReduceMotion(value);
    }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      preferenceChanged = true;
      setReduceMotion(value);
    });
    const app = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);

  const blinkOnce = useCallback(() => {
    if (!enabled) return;
    blinkAnimation.current?.stop();
    blink.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(blink, { toValue: 1, duration: 85, easing: Easing.out(Easing.quad), useNativeDriver: true, isInteraction: false }),
      Animated.delay(95),
      Animated.timing(blink, { toValue: 0, duration: 145, easing: Easing.inOut(Easing.quad), useNativeDriver: true, isInteraction: false }),
    ]);
    blinkAnimation.current = animation;
    animation.start();
  }, [blink, enabled]);

  useEffect(() => {
    if (!enabled) {
      float.setValue(0);
      blink.setValue(0);
      return;
    }
    const floating = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 2300, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(float, { toValue: 0, duration: 2700, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]));
    floating.start();
    if (blinkOnStart) blinkOnce();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const schedule = () => {
      timer = setTimeout(() => {
        if (stopped) return;
        blinkOnce();
        schedule();
      }, 2800 + Math.random() * 2400);
    };
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      floating.stop();
      blinkAnimation.current?.stop();
      float.setValue(0);
      blink.setValue(0);
    };
  }, [enabled, blinkOnce, blinkOnStart, float, blink]);

  const scale = size / sourceSize;
  const opacity = blink.interpolate({ inputRange: [0, 0.035, 0.08, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' });
  return <Pressable accessibilityRole="button" accessibilityLabel="留答 Logo，点一下眨眼" onPress={blinkOnce} style={{ width: size, height: size }}>
    <Animated.View pointerEvents="none" style={{ width: size, height: size, transform: [
      { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
      { rotate: float.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '0.8deg'] }) },
    ] }}>
      <Animated.View style={{ position: 'absolute', left: -size * 0.3, top: -size * 0.3, width: size * 1.6, height: size * 1.6,
        opacity: float.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
        transform: [{ scale: float.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
      }}>
        <Svg width="100%" height="100%" viewBox="0 0 160 160">
          <Defs>
            <RadialGradient id={glowId} cx="82" cy="78" r="72" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#fff" stopOpacity="0.13" />
              <Stop offset="0.2" stopColor="#fff" stopOpacity="0.14" />
              <Stop offset="0.36" stopColor="#fff" stopOpacity="0.11" />
              <Stop offset="0.52" stopColor="#fff" stopOpacity="0.065" />
              <Stop offset="0.74" stopColor="#fff" stopOpacity="0.028" />
              <Stop offset="1" stopColor="#fff" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="82" cy="78" r="72" fill={`url(#${glowId})`} />
        </Svg>
      </Animated.View>
      {!imageReady && <Svg width={size} height={size} viewBox="0 0 1254 1254" style={StyleSheet.absoluteFill}>
        <Path fill="#f1f0ee" d="M329 532 C329 350 481 218 662 218 C845 218 974 347 974 545 C974 817 739 1047 521 1047 C438 1047 370 1009 370 957 C370 926 398 908 435 903 C523 892 579 864 600 825 C614 799 586 793 554 787 C423 762 329 676 329 532 Z" />
        <Ellipse cx={606} cy={605} rx={31} ry={51} fill="#151515" rotation={-21} originX={606} originY={605} />
        <Ellipse cx={795} cy={555} rx={33} ry={56} fill="#151515" rotation={-21} originX={795} originY={555} />
      </Svg>}
      <Image
        accessible={false}
        source={logo}
        fadeDuration={0}
        onLoad={() => setImageReady(true)}
        onError={() => setImageReady(false)}
        style={{ width: size, height: size, opacity: imageReady ? 1 : 0 }}
      />
      {imageReady && eyes.map(eye => {
        const pad = 10;
        const left = (eye.x - pad) * scale;
        const top = (eye.y - pad) * scale;
        const width = (eye.width + pad * 2) * scale;
        const height = (eye.height + pad * 2) * scale;
        return <Animated.View key={eye.x} style={{ position: 'absolute', left, top, width, height, opacity }}>
          <LinearGradient colors={eye.colors} style={[StyleSheet.absoluteFill, { borderRadius: width / 2 }]} />
          <Animated.View style={{ width, height, overflow: 'hidden', borderRadius: width / 2, transform: [{ scaleY: blink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.07] }) }] }}>
            <Image accessible={false} source={logo} style={{ position: 'absolute', left: -left, top: -top, width: size, height: size }} />
          </Animated.View>
        </Animated.View>;
      })}
    </Animated.View>
  </Pressable>;
}
