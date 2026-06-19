defmodule SymphonyElixirWeb.ErrorJSONTest do
  use ExUnit.Case, async: false

  alias SymphonyElixirWeb.ErrorJSON

  test "renders the generic message when no exception info is present" do
    assert ErrorJSON.render("500.json", %{}) ==
             %{error: %{code: "request_failed", message: "Internal Server Error"}}
  end

  test "renders the matching status for known templates" do
    assert %{error: %{code: "request_failed", message: "Not Found"}} = ErrorJSON.render("404.json", %{})
  end

  test "exposes the exception message and stacktrace when exposure is enabled" do
    with_exposure(true, fn ->
      {reason, stack} =
        try do
          raise "boom from controller"
        rescue
          e -> {e, __STACKTRACE__}
        end

      assert %{error: error} = ErrorJSON.render("500.json", %{reason: reason, stack: stack})
      assert error.code == "request_failed"
      assert error.message =~ "boom from controller"
      assert error.exception == "RuntimeError"
      assert is_list(error.stacktrace)
      assert Enum.any?(error.stacktrace, &(&1 =~ "error_json_test"))
    end)
  end

  test "hides exception details when exposure is disabled" do
    with_exposure(false, fn ->
      reason = %RuntimeError{message: "secret internal detail"}

      assert ErrorJSON.render("500.json", %{reason: reason, stack: []}) ==
               %{error: %{code: "request_failed", message: "Internal Server Error"}}
    end)
  end

  defp with_exposure(value, fun) do
    prev = Application.fetch_env(:symphony_elixir, :expose_internal_errors)
    Application.put_env(:symphony_elixir, :expose_internal_errors, value)

    try do
      fun.()
    after
      case prev do
        {:ok, prev_value} -> Application.put_env(:symphony_elixir, :expose_internal_errors, prev_value)
        :error -> Application.delete_env(:symphony_elixir, :expose_internal_errors)
      end
    end
  end
end
