import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Image, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

const REVEAL_DURATION_MS = 900;
const ENERGY_LINE_LENGTH = 610;
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  onFinished: () => void;
  onReady?: () => void;
};

export function AnimatedSplash({ onFinished, onReady }: Props) {
  const completed = useRef(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const energyProgress = useSharedValue(0);
  const logoScale = useSharedValue(0.88);

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
    if (reduceMotion === null) return;
    if (reduceMotion) {
      finish();
      return;
    }

    energyProgress.value = withTiming(1, { duration: 620 });
    logoScale.value = withDelay(
      440,
      withSequence(
        withTiming(1.06, { duration: 140 }),
        withTiming(1, { duration: 200 }, (finished) => {
          if (finished) runOnJS(finish)();
        }),
      ),
    );

    const fallback = setTimeout(finish, REVEAL_DURATION_MS);
    return () => clearTimeout(fallback);
  }, [energyProgress, finish, logoScale, reduceMotion]);

  const energyLineProps = useAnimatedProps(() => ({
    strokeDashoffset: ENERGY_LINE_LENGTH * (1 - energyProgress.value),
    opacity: 0.35 + energyProgress.value * 0.65,
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion === null ? 0 : 1,
    transform: [{ scale: reduceMotion ? 1 : logoScale.value }],
  }));

  return (
    <View
      accessibilityLabel="Dev10x is starting"
      accessibilityRole="progressbar"
      onLayout={onReady ? (_event: LayoutChangeEvent) => onReady() : undefined}
      style={styles.container}
      testID="animated-splash"
    >
      {reduceMotion === false && (
        <Svg
          accessibilityElementsHidden
          height={260}
          style={styles.energyCanvas}
          viewBox="0 0 320 260"
          width={320}
        >
          <Defs>
            <LinearGradient id="energy" x1="0" x2="1" y1="0" y2="1">
              <Stop offset="0" stopColor="#6EE7FF" />
              <Stop offset="0.48" stopColor="#8B5CF6" />
              <Stop offset="1" stopColor="#F472B6" />
            </LinearGradient>
          </Defs>
          <AnimatedPath
            animatedProps={energyLineProps}
            d="M16 204 C16 70 112 28 160 28 C252 28 304 102 304 184 C304 222 256 238 160 238 C82 238 44 226 16 204"
            fill="none"
            stroke="url(#energy)"
            strokeDasharray={ENERGY_LINE_LENGTH}
            strokeLinecap="round"
            strokeWidth={5}
          />
        </Svg>
      )}
      <Animated.View style={[styles.logoWrap, logoStyle]}>
        <Image
          accessibilityLabel="Dev10x"
          resizeMode="contain"
          source={require("../../../assets/dev10x-logo-white.png")}
          style={styles.logo}
        />
      </Animated.View>
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
  energyCanvas: {
    position: "absolute",
  },
  logo: {
    height: 84,
    width: 240,
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
