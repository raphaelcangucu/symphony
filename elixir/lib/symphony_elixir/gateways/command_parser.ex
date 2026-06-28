defmodule SymphonyElixir.Gateways.CommandParser do
  @moduledoc "Parses provider-neutral gateway commands from chat text."

  @help ~w(/help /ajuda)
  @status ~w(/status /estado)
  @agent ~w(/agent /agente)
  @mode ~w(/mode /modo)
  @new ~w(/new /novo /reset)
  @stop ~w(/stop /parar)
  @setup ~w(/setup /configurar)
  @setup_pair ~w(/symphony_setup)
  @project_pair ~w(/symphony_pair /symphony_parear)
  @agents ~w(codex claude cursor)
  @modes ~w(explore project issue kb freeform)

  @type command ::
          {:help, map()}
          | {:status, map()}
          | {:show_agent, map()}
          | {:set_agent, map()}
          | {:show_mode, map()}
          | {:set_mode, map()}
          | {:new_session, map()}
          | {:stop, map()}
          | {:setup, map()}
          | {:setup_pair, map()}
          | {:project_pair, map()}

  @spec parse(String.t()) :: :plain_text | {:command, command()} | {:error, atom()}
  def parse(text) when is_binary(text) do
    trimmed = String.trim(text)

    cond do
      trimmed == "" -> :plain_text
      not String.starts_with?(trimmed, "/") -> :plain_text
      true -> parse_command(String.split(trimmed, ~r/\s+/, trim: true))
    end
  end

  def parse(_text), do: {:error, :invalid_text}

  defp parse_command([]), do: :plain_text

  defp parse_command([command | args]) do
    command = normalize_command(command)

    cond do
      command in @help -> {:command, {:help, %{}}}
      command in @status -> {:command, {:status, %{}}}
      command in @agent -> parse_agent(args)
      command in @mode -> parse_mode(args)
      command in @new -> {:command, {:new_session, %{}}}
      command in @stop -> {:command, {:stop, %{}}}
      command in @setup -> {:command, {:setup, %{}}}
      command in @setup_pair -> parse_code(args, :setup_pair)
      command in @project_pair -> parse_code(args, :project_pair)
      true -> {:error, :unknown_command}
    end
  end

  defp parse_agent([]), do: {:command, {:show_agent, %{}}}

  defp parse_agent([agent | _rest]) do
    case normalize_value(agent) do
      kind when kind in @agents -> {:command, {:set_agent, %{agent_kind: kind}}}
      _other -> {:error, :invalid_agent}
    end
  end

  defp parse_mode([]), do: {:error, :missing_mode}

  defp parse_mode([mode | args]) do
    case normalize_value(mode) do
      value when value in @modes -> {:command, {:set_mode, %{mode: value, args: args}}}
      _other -> {:error, :invalid_mode}
    end
  end

  defp parse_code([code | _rest], command) do
    case String.trim(code) do
      "" -> {:error, :missing_code}
      trimmed -> {:command, {command, %{code: trimmed}}}
    end
  end

  defp parse_code(_args, _command), do: {:error, :missing_code}

  defp normalize_command(command) do
    command
    |> String.trim()
    |> String.split("@", parts: 2)
    |> List.first()
    |> normalize_value()
  end

  defp normalize_value(value) do
    value
    |> String.trim()
    |> String.downcase()
  end
end
