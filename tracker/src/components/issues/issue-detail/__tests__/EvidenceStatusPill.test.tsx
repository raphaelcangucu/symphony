import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it } from "vitest";

import { EvidenceStatusPill } from "@/components/issues/issue-detail/EvidenceStatusPill";
import { i18n } from "@/i18n";
import { initTestI18n } from "@/i18n/testUtils";

function renderPill(status: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <EvidenceStatusPill status={status} />
    </I18nextProvider>,
  );
}

describe("EvidenceStatusPill", () => {
  beforeEach(async () => {
    await initTestI18n("en");
  });

  it("localizes canonical evidence statuses", () => {
    renderPill("passed");
    expect(screen.getByText(i18n.t("issue.evidence.status.passed"))).toBeInTheDocument();

    renderPill("blocked");
    expect(screen.getByText(i18n.t("issue.evidence.status.blocked"))).toBeInTheDocument();

    renderPill("failed");
    expect(screen.getByText(i18n.t("issue.evidence.status.failed"))).toBeInTheDocument();
  });

  it("maps fuzzy status values to known labels", () => {
    renderPill("  BLOCKED  ");
    expect(screen.getByText(i18n.t("issue.evidence.status.blocked"))).toBeInTheDocument();
  });

  it("localizes in pt-BR", async () => {
    await initTestI18n("pt-BR");
    renderPill("blocked");
    expect(screen.getByText("Bloqueado")).toBeInTheDocument();
  });
});
