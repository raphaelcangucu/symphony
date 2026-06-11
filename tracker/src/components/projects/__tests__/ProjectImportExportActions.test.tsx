import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectImportExportActions } from "@/components/projects/ProjectImportExportActions";
import * as projectImportExport from "@/services/projectImportExport";
import type { Project } from "@/types/project";

vi.mock("@/services/projectImportExport");

const sampleProject: Project = {
  id: "1",
  slug: "gamba",
  name: "Gamba",
  description: null,
  tracker: { kind: "local", config: {} },
};

describe("ProjectImportExportActions", () => {
  it("calls exportProject when Export is clicked", async () => {
    vi.mocked(projectImportExport.exportProject).mockResolvedValue("kind: symphony_project\n");

    render(<ProjectImportExportActions project={sampleProject} onImported={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => expect(projectImportExport.exportProject).toHaveBeenCalledWith("gamba"));
  });
});
