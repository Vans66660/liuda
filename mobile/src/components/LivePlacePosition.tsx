import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Location from 'expo-location';
import { readPosition, readPositionIfAllowed, toFix } from '../location/device';
import { type Fix, type Point } from '../location/geo';
import { LiudaPositionMap } from './LiudaPositionMap';
import { Action, ui } from './ui';

export function LivePlacePosition({ point, onFix }: { point: Point; onFix: (fix: Fix | null) => void }) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [tracking, setTracking] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    readPositionIfAllowed().then(result => {
      if (!active || !result) return;
      setFix(result);
      setTracking(true);
    }).catch(() => {
      if (active) setNotice('暂时无法定位，可以重新试一次。');
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!tracking) return;
    let active = true;
    let subscription: Location.LocationSubscription | undefined;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 2, timeInterval: 2000 }, value => {
      if (active) setFix(toFix(value));
    }, () => {
      if (active) setNotice('定位更新中断，可以重新定位。');
    }).then(result => {
      if (active) subscription = result;
      else result.remove();
    }).catch(() => { if (active) setNotice('暂时无法持续定位，可以重新定位。'); });
    return () => { active = false; subscription?.remove(); };
  }, [tracking]);

  useEffect(() => {
    onFix(fix);
    if (!fix) return;
    const timer = setTimeout(() => setFix(null), Math.max(0, fix.timestamp + 30_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [fix, onFix]);

  async function locate() {
    setBusy(true);
    setNotice('');
    setTracking(false);
    setFix(null);
    try {
      setFix(await readPosition());
      setTracking(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '定位暂时不可用。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <LiudaPositionMap point={point} fix={fix} />
      {notice ? <Text accessibilityLiveRegion="polite" style={ui.muted}>{notice}</Text> : null}
      {!fix && <Action secondary title={busy ? '正在定位…' : '定位我'} disabled={busy} onPress={locate} />}
    </View>
  );
}
