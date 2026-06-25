import {
  closestCorners,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";

import { GROUP_DRAG_PREFIX, ISSUE_DRAG_PREFIX } from "./board-utils";

function isUnitId(id: unknown): boolean {
  const value = String(id);
  return value.startsWith(ISSUE_DRAG_PREFIX) || value.startsWith(GROUP_DRAG_PREFIX);
}

/** Prefer issue/group cards under the pointer; fall back to column droppables for cross-column moves. */
export const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  const unitCollisions = pointerCollisions.filter(({ id }) => isUnitId(id));
  if (unitCollisions.length > 0) return unitCollisions;
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners(args);
};
