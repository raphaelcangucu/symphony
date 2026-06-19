defmodule SymphonyElixir.Evidence.JudgeTest do
  use ExUnit.Case, async: true

  @moduletag :tmp_dir

  alias SymphonyElixir.Evidence.Judge

  defp write_manifest!(ws, content) do
    dir = Path.join(ws, ".symphony/evidence")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "manifest.json"), content)
  end

  test "parse_verdict handles pass, fail, and garbage" do
    assert Judge.parse_verdict(~s({"verdict":"pass"})) == :pass
    assert Judge.parse_verdict(~s(prefix {"verdict":"fail","reasons":["no nav"]} done)) == {:fail, ["no nav"]}
    assert Judge.parse_verdict("not json at all") == :none
  end

  test "build_prompt includes criteria, diff, and test files" do
    prompt =
      Judge.build_prompt(%{criteria: "AC: email lookup", diff: "+ email column", test_files: [{"a.spec.js", "expect(1)"}]})

    assert prompt =~ "AC: email lookup"
    assert prompt =~ "+ email column"
    assert prompt =~ "a.spec.js"
  end

  test "verdict/2 runs the model, caches it, and reuses the cache", %{tmp_dir: ws} do
    write_manifest!(ws, ~s({"issue":"X","runs":[]}))

    runner = fn _ws, _prompt -> {:ok, ~s({"verdict":"fail","reasons":["does not exercise diff"]})} end
    input_fn = fn _ws -> %{criteria: "c", diff: "d", test_files: []} end

    assert {:fail, ["does not exercise diff"]} = Judge.verdict(ws, runner: runner, input_fn: input_fn)
    assert File.exists?(Path.join(ws, ".symphony/evidence/judge.json"))

    boom = fn _ws, _prompt -> raise "runner should not be called when cache hits" end
    assert {:fail, ["does not exercise diff"]} = Judge.verdict(ws, runner: boom, input_fn: input_fn)
  end

  test "disabled judge returns :none without running", %{tmp_dir: ws} do
    write_manifest!(ws, ~s({"issue":"X","runs":[]}))
    boom = fn _ws, _prompt -> raise "should not run" end
    assert Judge.verdict(ws, config: %{judge: %{enabled: false}}, runner: boom, input_fn: fn _ -> %{} end) == :none
  end

  test "model error yields :none (non-blocking)", %{tmp_dir: ws} do
    write_manifest!(ws, ~s({"issue":"X","runs":[]}))
    runner = fn _ws, _prompt -> {:error, :timeout} end
    assert Judge.verdict(ws, runner: runner, input_fn: fn _ -> %{criteria: "c", diff: "d", test_files: []} end) == :none
  end
end
