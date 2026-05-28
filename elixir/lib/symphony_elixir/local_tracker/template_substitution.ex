defmodule SymphonyElixir.LocalTracker.TemplateSubstitution do
  @moduledoc "Replaces {{slug}} / {{name}} / {{workspace_root}} tokens in template strings."

  @token ~r/\{\{\s*(slug|name|workspace_root)\s*\}\}/

  @spec apply(String.t() | nil, map()) :: String.t() | nil
  def apply(nil, _vars), do: nil

  def apply(value, vars) when is_binary(value) and is_map(vars) do
    Regex.replace(@token, value, fn _full, token ->
      vars |> Map.get(String.to_existing_atom(token)) |> to_string()
    end)
  end
end
