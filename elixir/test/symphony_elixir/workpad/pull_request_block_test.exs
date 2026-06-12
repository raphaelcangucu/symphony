defmodule SymphonyElixir.Workpad.PullRequestBlockTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workpad.PullRequestBlock

  @prs [
    %{repo: "GambaLabs/frontend", number: 1866, branch: "feat/DailyTipLimit", url: "https://github.com/GambaLabs/frontend/pull/1866"},
    %{repo: "GambaLabs/backend", number: 3997, branch: "symphony/1857", url: "https://github.com/GambaLabs/backend/pull/3997"}
  ]

  test "render round-trips through parse" do
    parsed = @prs |> PullRequestBlock.render() |> PullRequestBlock.parse()

    assert parsed == [
             %{repo: "GambaLabs/frontend", number: 1866, branch: "feat/DailyTipLimit", url: "https://github.com/GambaLabs/frontend/pull/1866"},
             %{repo: "GambaLabs/backend", number: 3997, branch: "symphony/1857", url: "https://github.com/GambaLabs/backend/pull/3997"}
           ]
  end

  test "parse returns [] when block absent or malformed" do
    assert PullRequestBlock.parse("## Codex Workpad\n\n### Plan\n- [ ] do it") == []
    assert PullRequestBlock.parse(nil) == []
    assert PullRequestBlock.parse("<!-- symphony:prs\ngarbage\n-->") == []
  end

  test "upsert_block inserts when absent, preserving other sections" do
    body = "## Codex Workpad\n\n### Plan\n- [x] done\n\n### Outcome\nin-progress"
    updated = PullRequestBlock.upsert_block(body, @prs)

    assert updated =~ "### Plan"
    assert updated =~ "### Outcome"
    assert PullRequestBlock.parse(updated) |> length() == 2
  end

  test "upsert_block replaces an existing block in place (idempotent on same input)" do
    body = PullRequestBlock.upsert_block("## Codex Workpad\n\n### Plan\n- [x] done", @prs)
    again = PullRequestBlock.upsert_block(body, @prs)

    assert again == body
    assert Regex.scan(~r/<!--\s*symphony:prs/, again) |> length() == 1
  end

  test "upsert_block on nil body creates a minimal workpad" do
    updated = PullRequestBlock.upsert_block(nil, @prs)
    assert updated =~ "## Codex Workpad"
    assert PullRequestBlock.parse(updated) |> length() == 2
  end
end
