import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Image, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

const REVEAL_DURATION_MS = 900;
const LIGHTNING_LENGTH = 250;
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  onFinished: () => void;
  onReady?: () => void;
};

export function AnimatedSplash({ onFinished, onReady }: Props) {
  const completed = useRef(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [markScale, setMarkScale] = useState(0);
  const leftLightningProgress = useSharedValue(0);
  const topLightningProgress = useSharedValue(0);
  const rightLightningProgress = useSharedValue(0);

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
    if (reduceMotion !== null) onReady?.();
  }, [onReady, reduceMotion]);

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      setMarkScale(1);
      finish();
      return;
    }

    leftLightningProgress.value = withTiming(1, { duration: 330 });
    topLightningProgress.value = withDelay(110, withTiming(1, { duration: 330 }));
    rightLightningProgress.value = withDelay(220, withTiming(1, { duration: 330 }));
    const revealMark = setTimeout(() => setMarkScale(1.13), 410);
    const settleMark = setTimeout(() => setMarkScale(1), 560);
    const fallback = setTimeout(finish, REVEAL_DURATION_MS);
    return () => {
      clearTimeout(fallback);
      clearTimeout(revealMark);
      clearTimeout(settleMark);
    };
  }, [finish, leftLightningProgress, reduceMotion, rightLightningProgress, topLightningProgress]);

  const leftLightningProps = useAnimatedProps(() => ({
    strokeDashoffset: LIGHTNING_LENGTH * (1 - leftLightningProgress.value),
    opacity: 0.25 + leftLightningProgress.value * 0.75,
  }));

  const topLightningProps = useAnimatedProps(() => ({
    strokeDashoffset: LIGHTNING_LENGTH * (1 - topLightningProgress.value),
    opacity: 0.25 + topLightningProgress.value * 0.75,
  }));

  const rightLightningProps = useAnimatedProps(() => ({
    strokeDashoffset: LIGHTNING_LENGTH * (1 - rightLightningProgress.value),
    opacity: 0.25 + rightLightningProgress.value * 0.75,
  }));

  return (
    <View
      accessibilityLabel="Dev10x is starting"
      accessibilityRole="progressbar"
      style={styles.container}
      testID="animated-splash"
    >
      {reduceMotion === false && (
        <Svg
          accessibilityElementsHidden
          height={360}
          style={styles.energyCanvas}
          viewBox="0 0 360 360"
          width={360}
        >
          <Defs>
            <LinearGradient id="lightning-cyan" x1="0" x2="1" y1="0" y2="1">
              <Stop offset="0" stopColor="#67E8F9" />
              <Stop offset="1" stopColor="#38BDF8" />
            </LinearGradient>
            <LinearGradient id="lightning-violet" x1="0" x2="1" y1="0" y2="1">
              <Stop offset="0" stopColor="#C4B5FD" />
              <Stop offset="1" stopColor="#8B5CF6" />
            </LinearGradient>
            <LinearGradient id="lightning-pink" x1="0" x2="1" y1="0" y2="1">
              <Stop offset="0" stopColor="#F9A8D4" />
              <Stop offset="1" stopColor="#EC4899" />
            </LinearGradient>
          </Defs>
          <AnimatedPath
            animatedProps={leftLightningProps}
            d="M12 188 L94 152 L78 184 L174 178"
            fill="none"
            stroke="url(#lightning-cyan)"
            strokeDasharray={LIGHTNING_LENGTH}
            strokeLinejoin="round"
            strokeWidth={8}
            testID="animated-splash-lightning"
          />
          <AnimatedPath
            animatedProps={topLightningProps}
            d="M182 12 L154 102 L194 82 L180 178"
            fill="none"
            stroke="url(#lightning-violet)"
            strokeDasharray={LIGHTNING_LENGTH}
            strokeLinejoin="round"
            strokeWidth={8}
            testID="animated-splash-lightning"
          />
          <AnimatedPath
            animatedProps={rightLightningProps}
            d="M348 206 L264 164 L280 196 L188 180"
            fill="none"
            stroke="url(#lightning-pink)"
            strokeDasharray={LIGHTNING_LENGTH}
            strokeLinejoin="round"
            strokeWidth={8}
            testID="animated-splash-lightning"
          />
        </Svg>
      )}
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
          style={styles.mark}
        />
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
  energyCanvas: {
    position: "absolute",
  },
  mark: {
    height: 148,
    width: 148,
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
