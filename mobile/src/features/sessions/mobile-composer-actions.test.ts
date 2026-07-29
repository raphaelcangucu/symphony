import { describe, expect, it } from "vitest";

import { MOBILE_COMPOSER_ACTIONS } from "./mobile-composer-actions";

describe("mobile composer actions", () => {
  it("keeps the approved actions in their decision-making order", () => {
    expect(MOBILE_COMPOSER_ACTIONS.map((action) => action.id)).toEqual([
      "plan",
      "magic",
      "context",
      "photo",
      "goal",
    ]);
  });
});
