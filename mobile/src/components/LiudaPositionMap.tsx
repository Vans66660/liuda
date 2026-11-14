import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { devApiUrl } from '../location/api';
import { distanceMeters, type Fix, type Point } from '../location/geo';
import campusRoadCoordinates from '../location/uibe-roads.json';
import { PhoneHeadingArrow } from './PhoneHeadingArrow';

const campusRoads = campusRoadCoordinates.map(road =>
  road.map(([longitude, latitude]) => ({ latitude, longitude }))
);
const campusCenter = { latitude: 39.978964, longitude: 116.421472 };

const height = 144;
const roadCache = new Map<string, Point[][]>();

export function LiudaPositionMap({ point, fix }: { point: Point; fix: Fix | null }) {
  const [width, setWidth] = useState(0);
  const [roadData, setRoadData] = useState<{ key: string; roads: Point[][] }>();
  // Query around the published note once, independently of live GPS updates.
  const { latitude, longitude } = point;
  const onCampus = distanceMeters(point, campusCenter) <= 480;
  const key = `${latitude},${longitude}`;
  useEffect(() => {
    if (onCampus) return;
    const controller = new AbortController();
    const cached = roadCache.get(key);
    if (cached) {
      Promise.resolve(cached).then(roads => {
        if (!controller.signal.aborted) setRoadData({ key, roads });
      });
      return () => controller.abort();
    }
    const url = __DEV__ && devApiUrl('/api/roads');
    if (!url) return;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude, longitude }),
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() as Promise<{ roads: Point[][] }> : null)
      .then(data => {
        if (!data || controller.signal.aborted) return;
        if (roadCache.size >= 24) roadCache.delete(roadCache.keys().next().value!);
        roadCache.set(key, data.roads);
        setRoadData({ key, roads: data.roads });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [key, latitude, longitude, onCampus]);

  const center = fix ?? point;
  const cx = width / 2;
  const cy = height / 2;
  function offset(target: Point) {
    return {
      x: (((target.longitude - center.longitude + 540) % 360) - 180) * 111_195 * Math.cos(center.latitude * Math.PI / 180),
      y: (center.latitude - target.latitude) * 111_195,
    };
  }
  const note = offset(point);
  const scale = Math.min(2, (cx - 24) / Math.max(1, Math.abs(note.x)), (cy - 24) / Math.max(1, Math.abs(note.y)));
  const x = cx + note.x * scale;
  const y = cy + note.y * scale;
  const distance = fix ? distanceMeters(fix, point) : null;
  const distanceLabel = distance === null ? '定位后查看距离' : distance >= 1000
    ? `直线 ${(distance / 1000).toFixed(1)} 公里` : `直线约 ${Math.round(distance)} 米`;
  const availableRoads = onCampus ? campusRoads : roadData?.key === key ? roadData.roads : [];
  const roads = (distance ?? 0) < 450 ? availableRoads : [];

  return <View
    accessible accessibilityLabel={`留话位置，${distanceLabel}`}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}
    style={styles.frame}
  >
    {width > 48 && <Svg width={width} height={height}>
      {roads.map((road, index) => (
        <Path key={index} d={road.map((vertex, i) => {
          const { x, y } = offset(vertex);
          return `${i ? 'L' : 'M'}${cx + x * scale} ${cy + y * scale}`;
        }).join(' ')} stroke="#43564e" strokeWidth={2.5} strokeLinejoin="round" fill="none" />
      ))}
      {fix && <Line x1={cx} y1={cy} x2={x} y2={y} stroke="#d2e6ae" strokeWidth={2} strokeDasharray="4 4" />}
      <Circle cx={x} cy={y} r={7} fill="#f3f2df" stroke="#202d28" strokeWidth={2} />
      {fix && <Circle cx={cx} cy={cy} r={13} fill="none" stroke="#9cb77c" strokeWidth={1} />}
      {fix && <Circle cx={cx} cy={cy} r={5} fill="#c2e095" stroke="#202d28" strokeWidth={1.5} />}
    </Svg>}
    {fix && <PhoneHeadingArrow />}
    <Text style={styles.distance}>{distanceLabel}</Text>
    <Text style={styles.legend}>{fix ? '● 你　○ 留话' : '○ 留话'}</Text>
    <Text style={styles.credit}>{roads.length ? '© OpenStreetMap' : '位置示意'}</Text>
  </View>;
}

const styles = StyleSheet.create({
  frame: { height, borderRadius: 20, backgroundColor: '#202d28', overflow: 'hidden' },
  distance: { position: 'absolute', top: 11, left: 12, color: '#e8f0d6', backgroundColor: '#202d28', padding: 4, fontSize: 14, fontWeight: '600' },
  legend: { position: 'absolute', bottom: 9, left: 12, color: '#e8f0d6', backgroundColor: '#202d28', padding: 4, fontSize: 11 },
  credit: { position: 'absolute', bottom: 9, right: 12, color: '#b5c5bc', backgroundColor: '#202d28', padding: 4, fontSize: 10 },
});
