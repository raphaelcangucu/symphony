defmodule SymphonyElixirWeb.ErrorJSON do
  @moduledoc false

  @spec render(String.t(), map()) :: map()
  def render(template, assigns) do
    %{error: error_body(template, assigns)}
  end

  defp error_body(template, assigns) do
    base = %{code: "request_failed", message: Phoenix.Controller.status_message_from_template(template)}

    case debug_info(assigns) do
      nil -> base
      debug -> Map.merge(base, debug)
    end
  end

  # In dev/test, surface the underlying exception and stacktrace so API clients
  # (curl, the tracker UI) see the real failure instead of a bare
  # "Internal Server Error". Phoenix passes the caught `:reason`/`:stack` into the
  # error view's assigns (see Phoenix.Endpoint.RenderErrors). Disabled in prod to
  # avoid leaking internals.
  defp debug_info(%{reason: reason, stack: stack}) when not is_nil(reason) do
    if expose_internal_errors?() do
      %{
        message: error_message(reason),
        exception: error_type(reason),
        stacktrace: format_stack(stack)
      }
    else
      nil
    end
  end

  defp debug_info(_assigns), do: nil

  defp error_message(%{__exception__: true} = reason), do: Exception.message(reason)
  defp error_message(reason), do: inspect(reason)

  defp error_type(%{__struct__: module}), do: inspect(module)
  defp error_type(_reason), do: "throw"

  defp format_stack(stack) when is_list(stack) do
    Enum.map(stack, &String.trim_trailing(Exception.format_stacktrace_entry(&1)))
  end

  defp format_stack(_stack), do: []

  defp expose_internal_errors? do
    Application.get_env(:symphony_elixir, :expose_internal_errors, dev_or_test?())
  end

  defp dev_or_test? do
    function_exported?(Mix, :env, 0) and Mix.env() in [:dev, :test]
  end
end
