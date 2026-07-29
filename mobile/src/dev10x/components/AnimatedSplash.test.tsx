import { act, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (Component: unknown) => Component },
    runOnJS: (callback: () => void) => callback,
    useAnimatedProps: (factory: () => object) => factory(),
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withDelay: (_delay: number, value: number) => value,
    withSequence: (...values: number[]) => values.at(-1),
    withTiming: (value: number) => value,
  };
});

import { AnimatedSplash } from "./AnimatedSplash";

describe("AnimatedSplash", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("calls onFinished after the energy-line reveal", async () => {
    const onFinished = jest.fn();
    render(<AnimatedSplash onFinished={onFinished} />);

    await act(async () => {
      await Promise.resolve();
    });
    act(() => jest.advanceTimersByTime(900));

    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Dev10x is starting")).toBeTruthy();
  });

  it("reveals the logo after motion preference is resolved", async () => {
    const onReady = jest.fn();
    render(<AnimatedSplash onFinished={jest.fn()} onReady={onReady} />);

    expect(onReady).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("animated-splash-logo")).toHaveStyle({ opacity: 1 });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("skips the energy-line animation when reduced motion is enabled", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const onFinished = jest.fn();
    render(<AnimatedSplash onFinished={onFinished} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Dev10x is starting")).toBeTruthy();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
