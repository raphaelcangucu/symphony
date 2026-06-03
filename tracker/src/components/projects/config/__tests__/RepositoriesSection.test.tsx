import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RepositoriesSection } from "@/components/projects/config/RepositoriesSection";
import * as projectSetup from "@/services/projectSetup";
import type { WorkspaceRepository } from "@/types/repository";

vi.mock("@/services/projectSetup");

function repository(overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository {
  return {
    fullName: "acme/web",
    workspacePath: "acme/web",
    role: "frontend",
    selectedBranch: "main",
    ...overrides,
  };
}

describe("RepositoriesSection", () => {
  afterEach(() => vi.clearAllMocks());

  it("lists linked repositories with editable fields", () => {
    vi.mocked(projectSetup.listGitHubOwners).mockResolvedValue([]);
    render(<RepositoriesSection value={[repository()]} onChange={vi.fn()} />);

    expect(screen.getByText("acme/web")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace path for acme/web")).toHaveValue("acme/web");
    expect(screen.getByLabelText("Role for acme/web")).toHaveValue("frontend");
    expect(screen.getByLabelText("Branch for acme/web")).toHaveValue("main");
  });

  it("emits an updated workspace path on edit", async () => {
    vi.mocked(projectSetup.listGitHubOwners).mockResolvedValue([]);
    const onChange = vi.fn();
    render(<RepositoriesSection value={[repository()]} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("Workspace path for acme/web"), "x");

    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ fullName: "acme/web", workspacePath: "acme/webx" })]);
  });

  it("removes a repository", async () => {
    vi.mocked(projectSetup.listGitHubOwners).mockResolvedValue([]);
    const onChange = vi.fn();
    render(<RepositoriesSection value={[repository(), repository({ fullName: "acme/api" })]} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove acme/web" }));

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ fullName: "acme/api" })]);
  });

  it("adds a repository from the GitHub picker with derived defaults", async () => {
    vi.mocked(projectSetup.listGitHubOwners).mockResolvedValue([{ login: "acme", kind: "organization" }]);
    vi.mocked(projectSetup.listGitHubRepositories).mockResolvedValue([
      { fullName: "acme/api", workspacePath: "", role: "", defaultBranch: "develop", private: true },
    ]);
    const onChange = vi.fn();
    render(<RepositoriesSection value={[]} onChange={onChange} />);

    await waitFor(() => expect(projectSetup.listGitHubOwners).toHaveBeenCalled());
    await userEvent.selectOptions(screen.getByLabelText("GitHub owner"), "acme");
    await waitFor(() => expect(projectSetup.listGitHubRepositories).toHaveBeenCalledWith("acme"));

    await userEvent.click(await screen.findByRole("button", { name: "Add acme/api" }));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        fullName: "acme/api",
        workspacePath: "api",
        role: "backend",
        selectedBranch: "develop",
      }),
    ]);
  });

  it("does not re-add an already-linked repository", async () => {
    vi.mocked(projectSetup.listGitHubOwners).mockResolvedValue([{ login: "acme", kind: "organization" }]);
    vi.mocked(projectSetup.listGitHubRepositories).mockResolvedValue([repository({ fullName: "acme/web" })]);
    const onChange = vi.fn();
    render(<RepositoriesSection value={[repository({ fullName: "acme/web" })]} onChange={onChange} />);

    await userEvent.selectOptions(await screen.findByLabelText("GitHub owner"), "acme");

    const addButton = await screen.findByRole("button", { name: "Add acme/web" });
    expect(addButton).toBeDisabled();
  });
});
