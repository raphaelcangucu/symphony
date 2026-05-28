import { describe, expect, it, vi, beforeEach } from "vitest";
import { listTemplates, instantiateTemplate, importTemplate } from "@/services/templates";
import { http } from "@/services/http";

vi.mock("@/services/http", async () => {
  const actual = await vi.importActual<typeof import("@/services/http")>("@/services/http");
  return { ...actual, http: { get: vi.fn(), post: vi.fn() } };
});

describe("templates service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listTemplates normalizes response", async () => {
    (http.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: 1, name: "G", slug: "g", validation_commands: ["mix test"], repositories: [] }] },
    });

    const result = await listTemplates();
    expect(result[0].slug).toBe("g");
    expect(result[0].validationCommands).toEqual(["mix test"]);
  });

  it("instantiateTemplate posts name+slug+tracker", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 1, slug: "g1", name: "G1" } } });
    await instantiateTemplate("g", { name: "G1", slug: "g1", tracker: { kind: "local", config: {} } });
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining("/templates/g/instantiate"),
      expect.objectContaining({ name: "G1", slug: "g1" }),
    );
  });

  it("importTemplate posts yaml", async () => {
    (http.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: { id: 1, slug: "g", name: "G", repositories: [] } } });
    await importTemplate("slug: g\nname: G\n");
    expect(http.post).toHaveBeenCalledWith(expect.stringContaining("/templates/import"), { yaml: "slug: g\nname: G\n" });
  });
});
