import type { ComponentProps } from "react";
import { View } from "react-native";

type IconProps = ComponentProps<typeof View>;

function Icon(props: IconProps) {
  return <View {...props} />;
}

export const ChevronDown = Icon;
export const ChevronLeft = Icon;
export const ChevronRight = Icon;
export const ArrowLeft = Icon;
export const Bot = Icon;
export const Brain = Icon;
export const Clock3 = Icon;
export const Compass = Icon;
export const Files = Icon;
export const FileText = Icon;
export const Folder = Icon;
export const Hammer = Icon;
export const Info = Icon;
export const Image = Icon;
export const ListChecks = Icon;
export const MoreHorizontal = Icon;
export const Maximize2 = Icon;
export const Mic = Icon;
export const Pause = Icon;
export const Pencil = Icon;
export const Play = Icon;
export const Plus = Icon;
export const Search = Icon;
export const RotateCw = Icon;
export const Route = Icon;
export const Share2 = Icon;
export const SendHorizontal = Icon;
export const ShieldAlert = Icon;
export const SlidersHorizontal = Icon;
export const Square = Icon;
export const SquarePen = Icon;
export const SquareTerminal = Icon;
export const Target = Icon;
export const Trash2 = Icon;
export const X = Icon;
export const Zap = Icon;
export const ZoomIn = Icon;
