defmodule SymphonyElixir.SessionLogBackend do
  @moduledoc """
  Behaviour for agent-specific resolution of SUBAGENT (child session) logs.

  Parent session tails remain on each agent's existing `SessionLog` module;
  this behaviour covers locating and describing child transcripts whose on-disk
  layout differs per agent.
  """

  @doc """
  Resolves a subagent transcript path by id (and agent-specific opts).
  """
  @callback resolve_subagent_path(id :: String.t(), opts :: keyword()) :: {:ok, Path.t()} | :error

  @doc """
  Lists known subagents for a parent transcript path.

  Returns maps with string keys:
  `%{"id" => ..., "label" => ..., "nickname" => ..., "role" => ..., "tool_use_id" => ..., "path" => ...}`
  (nil where unknown).
  """
  @callback list_subagents(parent_path :: Path.t(), opts :: keyword()) :: [map()]

  @doc """
  Reads lightweight metadata for a subagent transcript path.

  Returns a map with the same string keys as `list_subagents/2` (minus `"id"` /
  `"path"` when not applicable).
  """
  @callback subagent_meta(path :: Path.t()) :: map()
end
