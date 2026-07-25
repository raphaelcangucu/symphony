import type { ComponentProps } from "react";
import { View } from "react-native";

type IconProps = ComponentProps<typeof View>;

function Icon(props: IconProps) {
  return <View {...props} />;
}

export const ChevronDown = Icon;
export const ChevronRight = Icon;
export const ArrowLeft = Icon;
export const Folder = Icon;
export const MoreHorizontal = Icon;
export const Mic = Icon;
export const Search = Icon;
export const SendHorizontal = Icon;
export const SlidersHorizontal = Icon;
export const SquarePen = Icon;
export const SquareTerminal = Icon;
