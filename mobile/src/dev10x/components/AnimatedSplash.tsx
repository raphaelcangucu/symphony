import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Image, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const REVEAL_DURATION_MS = 900;
const MARK_SOURCE_SIZE = 240;
const MARK_WIDTH = 240;
const MARK_HEIGHT = 150;
const MARK_SOURCE_TOP = -45;
const PULSE_DISTANCE = 180;

type Props = {
  onFinished: () => void;
  onReady?: () => void;
};

export function AnimatedSplash({ onFinished, onReady }: Props) {
  const completed = useRef(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [markScale, setMarkScale] = useState(0);
  const pulseProgress = useSharedValue(-1);

  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    onFinished();
  }, [onFinished]);

  useEffect(() => {
    let active = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active) setReduceMotion(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      setMarkScale(1);
      pulseProgress.value = 1;
      finish();
      return;
    }

    setMarkScale(1);
    pulseProgress.value = withTiming(1, { duration: 650 });
    const fallback = setTimeout(finish, REVEAL_DURATION_MS);
    return () => {
      clearTimeout(fallback);
    };
  }, [finish, pulseProgress, reduceMotion]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pulseProgress.value * PULSE_DISTANCE }],
  }));

  return (
    <View
      accessibilityLabel="Dev10x is starting"
      accessibilityRole="progressbar"
      style={styles.container}
      testID="animated-splash"
    >
      <View
        style={[
          styles.logoWrap,
          { opacity: reduceMotion === null ? 0 : 1, transform: [{ scale: markScale }] },
        ]}
        testID="animated-splash-mark"
      >
        <Image
          accessibilityLabel="Dev10x mark"
          resizeMode="contain"
          source={require("../../../assets/dev10x-icon.png")}
          style={styles.markSource}
        />
        {reduceMotion === false && (
          <Animated.View style={[styles.pulse, pulseStyle]} testID="animated-splash-pulse">
            <Image
              source={require("../../../assets/dev10x-icon.png")}
              style={styles.pulseMark}
              tintColor="#67E8F9"
              testID="animated-splash-pulse-mark"
            />
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "#090A0F",
    justifyContent: "center",
  },
  logoWrap: {
    height: MARK_HEIGHT,
    overflow: "hidden",
    position: "relative",
    width: MARK_WIDTH,
  },
  markSource: {
    height: MARK_SOURCE_SIZE,
    left: 0,
    position: "absolute",
    top: MARK_SOURCE_TOP,
    width: MARK_SOURCE_SIZE,
  },
  pulse: {
    height: MARK_HEIGHT,
    left: MARK_WIDTH / 2 - 18,
    overflow: "hidden",
    position: "absolute",
    top: 0,
    width: 36,
  },
  pulseMark: {
    height: MARK_SOURCE_SIZE,
    left: -(MARK_WIDTH / 2 - 18),
    position: "absolute",
    top: MARK_SOURCE_TOP,
    width: MARK_SOURCE_SIZE,
  },
});
