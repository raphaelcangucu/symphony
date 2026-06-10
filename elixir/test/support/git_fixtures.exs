defmodule SymphonyElixir.GitFixtures do
  @moduledoc """
  Shared git fixtures for tests that exercise real repositories: a bare
  origin plus a clone with one commit on `main`, ready for branch work.
  """

  @spec sh!(Path.t(), String.t()) :: String.t()
  def sh!(dir, cmd) do
    {out, 0} = System.cmd("sh", ["-lc", cmd], cd: dir, stderr_to_stdout: true)
    out
  end

  @doc """
  Creates origin (bare) + a clone at `workspace/<name>` with one commit on
  `main`, pushed and tracking origin. Returns the clone path.
  """
  @spec make_repo!(Path.t(), Path.t(), String.t()) :: Path.t()
  def make_repo!(tmp_dir, workspace, name) do
    origin = Path.join(tmp_dir, "#{name}-origin.git")
    repo = Path.join(workspace, name)
    File.mkdir_p!(origin)
    File.mkdir_p!(repo)
    sh!(origin, "git init --bare -b main .")

    sh!(repo, """
    git init -b main . &&
    git config user.email t@t && git config user.name t &&
    echo hello > README.md && git add -A && git commit -m init &&
    git remote add origin "#{origin}" && git push -u origin main &&
    git remote set-head origin main
    """)

    repo
  end
end
