defmodule SymphonyElixir.Workpad.ExecutionBundle do
  @moduledoc """
  Parses the `### Execution bundle` section of a `## Codex Workpad`.

  The bundle is the authoring-time, preclassified execution plan for a parent
  issue: ordered units (`:workpad_task` | `:child_run`), shared contracts, and
  dependency edges. The runner consumes it; it never re-derives structure.
  """

  @type unit :: %{
          id: String.t(),
          type: :workpad_task | :child_run,
          issue: String.t() | nil,
          repo: String.t() | nil,
          produces: [String.t()],
          consumes: [String.t()],
          depends_on: [String.t()],
          deliverable: String.t() | nil
        }

  @type contract :: %{
          id: String.t(),
          kind: String.t() | nil,
          owner_unit: String.t() | nil,
          consumers: [String.t()],
          artifact: String.t() | nil,
          status: :draft | :ready | :changing
        }

  @type t :: %__MODULE__{
          version: integer() | nil,
          mode: String.t() | nil,
          parent: String.t() | nil,
          units: [unit()],
          shared_contracts: [contract()]
        }

  defstruct version: nil, mode: nil, parent: nil, units: [], shared_contracts: []

  @spec parse(String.t() | nil) :: {:ok, t()} | :absent
  def parse(body) when is_binary(body) do
    with {:ok, section} <- section(body, "Execution bundle"),
         {:ok, yaml} <- yaml_block(section),
         {:ok, map} <- YamlElixir.read_from_string(yaml) do
      {:ok, build(map)}
    else
      _ -> :absent
    end
  end

  def parse(_body), do: :absent

  @spec child_units(t()) :: [unit()]
  def child_units(%__MODULE__{units: units}), do: Enum.filter(units, &(&1.type == :child_run))

  @spec workpad_units(t()) :: [unit()]
  def workpad_units(%__MODULE__{units: units}), do: Enum.filter(units, &(&1.type == :workpad_task))

  defp build(map) do
    %__MODULE__{
      version: map["version"],
      mode: map["mode"],
      parent: map["parent"],
      units: Enum.map(list(map["units"]), &build_unit/1),
      shared_contracts: Enum.map(list(map["shared_contracts"]), &build_contract/1)
    }
  end

  defp build_unit(u) do
    %{
      id: u["id"],
      type: unit_type(u["type"]),
      issue: u["issue"],
      repo: u["repo"],
      produces: list(u["produces"]),
      consumes: list(u["consumes"]),
      depends_on: list(u["depends_on"]),
      deliverable: u["deliverable"]
    }
  end

  defp build_contract(c) do
    %{
      id: c["id"],
      kind: c["kind"],
      owner_unit: c["owner_unit"],
      consumers: list(c["consumers"]),
      artifact: c["artifact"],
      status: contract_status(c["status"])
    }
  end

  defp unit_type("child_run"), do: :child_run
  defp unit_type(_), do: :workpad_task

  defp contract_status("ready"), do: :ready
  defp contract_status("changing"), do: :changing
  defp contract_status(_), do: :draft

  defp list(value) when is_list(value), do: value
  defp list(_), do: []

  # Reuses the heading-scoped extraction approach from ExecutionContract.
  defp section(body, title) do
    lines = String.split(body, ~r/\R/)
    downcased = String.downcase(title)

    {section_lines, _state} =
      Enum.reduce(lines, {[], :before}, fn line, {acc, state} ->
        cond do
          heading?(line, downcased) -> {acc, :inside}
          state == :inside and Regex.match?(~r/^\s*\#{1,6}\s+/, line) -> {acc, :after}
          state == :inside -> {[line | acc], :inside}
          true -> {acc, state}
        end
      end)

    case Enum.reverse(section_lines) do
      [] -> :error
      collected -> {:ok, Enum.join(collected, "\n")}
    end
  end

  defp heading?(line, expected) do
    line |> String.trim() |> String.trim_leading("#") |> String.trim() |> String.downcase() == expected
  end

  defp yaml_block(section) do
    case Regex.run(~r/```ya?ml\s*\n(?<body>.*?)\n```/s, section, capture: ["body"]) do
      [body] -> {:ok, body}
      _ -> :error
    end
  end
end
