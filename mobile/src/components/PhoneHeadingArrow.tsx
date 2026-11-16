import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import Svg, { Path } from 'react-native-svg';

export function PhoneHeadingArrow() {
  const [heading, setHeading] = useState<number | null>(null);

  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    let subscription: Location.LocationSubscription | undefined;

    Location.watchHeadingAsync(({ accuracy, trueHeading }) => {
      if (!active) return;
      setHeading(accuracy > 0 && Number.isFinite(trueHeading) && trueHeading >= 0
        ? Math.round(trueHeading) % 360
        : null);
    }, () => {
      if (active) setHeading(null);
    }).then(result => {
      if (active) subscription = result;
      else result.remove();
    }).catch(() => {
      if (active) setHeading(null);
    });

    return () => {
      active = false;
      subscription?.remove();
      setHeading(null);
    };
  }, []));

  if (heading === null) return null;
  return (
    <View pointerEvents="none" style={[styles.arrow, { transform: [{ rotate: `${heading}deg` }] }]}>
      <Svg width={56} height={56} viewBox="0 0 56 56">
        <Path d="M28 3 L35 18 L28 15 L21 18 Z" fill="#c2e095" stroke="#202d28" strokeWidth={1.5} strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: { position: 'absolute', top: '50%', left: '50%', marginTop: -28, marginLeft: -28 },
});
