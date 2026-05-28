import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TemplateList } from "@/components/templates/TemplateList";

describe("TemplateList", () => {
  it("renders templates with repo counts", () => {
    render(
      <MemoryRouter>
        <TemplateList
          templates={[
            { id: "1", name: "Gamba", slug: "gamba", description: null, validationCommands: [], workflowStatuses: [], afterCreateHook: null, promptTemplate: null, devEnvMarkdown: null, metadata: {}, repositories: [{ githubFullName: "g/api", cloneUrl: "u", defaultBranch: "main", workspacePath: "api", role: "backend" }] },
          ]}
          onDelete={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Gamba")).toBeInTheDocument();
    expect(screen.getByText(/1 repo/i)).toBeInTheDocument();
  });
});
