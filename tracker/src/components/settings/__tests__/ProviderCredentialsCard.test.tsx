import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderCredentialsCard } from "@/components/settings/ProviderCredentialsCard";
import * as settingsService from "@/services/settings";
import type { CredentialProvider } from "@/services/settings";

vi.mock("@/services/settings", () => ({
  fetchCredentials: vi.fn(),
  updateCredential: vi.fn(),
  clearCredential: vi.fn(),
}));

const githubProvider: CredentialProvider = {
  provider: "github",
  label: "GitHub",
  fields: [{ key: "token", label: "Personal access token", secret: true, configured: true, source: "db", hint: "••••9999" }],
};

describe("ProviderCredentialsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsService.fetchCredentials).mockResolvedValue([githubProvider]);
  });

  it("masks a configured secret and never pre-fills the input", async () => {
    render(<ProviderCredentialsCard />);

    const input = await screen.findByPlaceholderText(/••••9999/);
    expect((input as HTMLInputElement).value).toBe("");
    expect((input as HTMLInputElement).type).toBe("password");
    expect(screen.getByText("Saved here")).toBeTruthy();
  });

  it("saves a new secret value via PUT and clears the field", async () => {
    vi.mocked(settingsService.updateCredential).mockResolvedValue(githubProvider);

    render(<ProviderCredentialsCard />);

    const input = (await screen.findByPlaceholderText(/••••9999/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ghp_brandnewtoken" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(settingsService.updateCredential).toHaveBeenCalledWith("github", "token", "ghp_brandnewtoken"),
    );
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("clears a db-sourced credential via DELETE", async () => {
    vi.mocked(settingsService.clearCredential).mockResolvedValue({
      ...githubProvider,
      fields: [{ key: "token", label: "Personal access token", secret: true, configured: false, source: "none", hint: null }],
    });

    render(<ProviderCredentialsCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));

    await waitFor(() => expect(settingsService.clearCredential).toHaveBeenCalledWith("github", "token"));
    await waitFor(() => expect(screen.getByText("Not set")).toBeTruthy());
  });
});
