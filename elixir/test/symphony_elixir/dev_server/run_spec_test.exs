defmodule SymphonyElixir.DevServer.RunSpecTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.RunSpec

  test "normalize requires start list and expands PORT" do
    assert {:ok, spec} =
             RunSpec.normalize(
               %{
                 "cwd" => "frontend",
                 "prepare" => [["bash", "wire.sh"]],
                 "start" => [["nuxi", "dev", "--port", "${PORT}"]],
                 "health" => %{"path" => "/api/health", "timeout_ms" => 1_000},
                 "stop" => %{"signal" => "TERM"}
               },
               port: 4102
             )

    assert spec.cwd == "frontend"
    assert hd(spec.start).argv == ["nuxi", "dev", "--port", "4102"]
  end

  test "exists-gated start entry is kept with exists path" do
    assert {:ok, spec} =
             RunSpec.normalize(
               %{
                 "start" => [
                   %{
                     "exists" => "scripts/graphql-reload",
                     "run" => ["bash", "./scripts/graphql-reload"]
                   },
                   ["docker", "logs", "-f", "inspire"]
                 ],
                 "health" => %{"path" => "/health"}
               },
               port: 4301
             )

    assert length(spec.start) == 2
    assert hd(spec.start).exists == "scripts/graphql-reload"
  end

  test "allows shell metacharacters inside an explicit bash -lc script argument" do
    assert {:ok, spec} =
             RunSpec.normalize(
               %{
                 "start" => [
                   ["bash", "-lc", "export APP_PORT=${PORT:-4100}; ./vibe up && docker logs -f app"]
                 ],
                 "stop" => %{"command" => ["bash", "-lc", "./vibe down || true"]}
               },
               port: 4100
             )

    assert hd(spec.start).argv == [
             "bash",
             "-lc",
             "export APP_PORT=${PORT:-4100}; ./vibe up && docker logs -f app"
           ]

    assert spec.stop.command == ["bash", "-lc", "./vibe down || true"]
  end

  test "rejects shell metacharacters outside an explicit shell script argument" do
    assert {:error, :rejected_shell_metacharacters} =
             RunSpec.normalize(
               %{"start" => [["./vibe", "up", "&&", "./vibe", "bootstrap"]]},
               port: 4100
             )

    assert {:error, :rejected_shell_metacharacters} =
             RunSpec.normalize(
               %{
                 "start" => [["python3", "-m", "http.server"]],
                 "stop" => %{"command" => ["sh", "stop.sh", "||", "true"]}
               },
               port: 4100
             )
  end

  test "rejects empty start" do
    assert {:error, :missing_start} = RunSpec.normalize(%{"health" => %{"path" => "/"}}, port: 1)
  end
end
