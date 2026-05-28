import { describe, expect, it, vi } from "vitest";

import { http } from "@/services/http";
import { createProject } from "@/services/projects";

describe("project service", () => {
  it("creates a project through the tracker API", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({
      data: {
        data: {
          id: 1,
          name: "Macro Markets",
          slug: "macro-markets",
          description: "Local tracker",
          issue_count: 0,
          statuses: [],
        },
      },
    });

    const project = await createProject({
      name: "Macro Markets",
      slug: "macro-markets",
      description: "Local tracker",
    });

    expect(post).toHaveBeenCalledWith("/api/tracker/v1/projects", {
      name: "Macro Markets",
      slug: "macro-markets",
      description: "Local tracker",
    });
    expect(project).toMatchObject({ name: "Macro Markets", slug: "macro-markets" });

    post.mockRestore();
  });
});
