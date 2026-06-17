import {
  closestCorners,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";

import { ISSUE_DRAG_PREFIX } from "./board-utils";

/** Prefer issue cards under the pointer; fall back to column droppables for cross-column moves. */
export const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  const issueCollisions = pointerCollisions.filter(({ id }) => String(id).startsWith(ISSUE_DRAG_PREFIX));
  if (issueCollisions.length > 0) return issueCollisions;
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners(args);
};
