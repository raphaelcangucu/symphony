defmodule SymphonyElixir.Skills do
  @moduledoc "Loads vendored, agent-agnostic skill definitions from the repo `skills/` directory."

  @superpowers_dir "superpowers"
  @skill_file "SKILL.md"
  @separator "\n\n---\n\n"

  @doc """
  Resolves the repo-root `skills/` directory.

  Prefers the `:skills_root` application env (set in config) so resolution never
  depends on relative-path climbing. Falls back to climbing from the app's
  `priv` dir up to the repo root.

  `:code.priv_dir(:symphony_elixir)` returns
  `.../symphony/elixir/_build/<env>/lib/symphony_elixir/priv`, so reaching the
  repo-root `skills/` requires climbing six segments:
  `priv -> symphony_elixir -> lib -> <env> -> _build -> elixir -> <repo root>`.
  """
  @spec root() :: Path.t()
  def root do
    Application.get_env(:symphony_elixir, :skills_root) ||
      Path.expand(
        Path.join([
          :code.priv_dir(:symphony_elixir) |> to_string(),
          "..",
          "..",
          "..",
          "..",
          "..",
          "..",
          "skills"
        ])
      )
  end

  @spec available() :: [String.t()]
  def available do
    base = Path.join(root(), @superpowers_dir)

    case File.ls(base) do
      {:ok, entries} ->
        entries
        |> Enum.filter(&File.regular?(Path.join([base, &1, @skill_file])))
        |> Enum.sort()

      _ ->
        []
    end
  end

  @spec load([String.t()]) :: String.t()
  def load(names) when is_list(names) do
    names
    |> Enum.map(&read_skill/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.join(@separator)
  end

  defp read_skill(name) when is_binary(name) do
    path = Path.join([root(), @superpowers_dir, name, @skill_file])

    case File.read(path) do
      {:ok, body} -> body
      {:error, _} -> ""
    end
  end
end
