defmodule SymphonyElixir.Claude.EventHumanizerTest do
  use ExUnit.Case, async: true

  alias Gettext
  alias SymphonyElixir.Claude.EventHumanizer
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  setup do
    Gettext.put_locale(GettextBackend, "en")
    :ok
  end

  test "humanizes turn/started in English" do
    assert EventHumanizer.humanize_method("turn/started", %{"params" => %{"turn_id" => "abc123"}}) =~
             "turn started"
  end

  test "humanizes turn/started in Portuguese" do
    Gettext.put_locale(GettextBackend, "pt_BR")

    assert EventHumanizer.humanize_method("turn/started", %{}) == "turn iniciado"
  end

  test "humanizes permission denied with tool name" do
    payload = %{
      "params" => %{
        "denials" => [%{"tool_name" => "Bash"}]
      }
    }

    assert EventHumanizer.humanize_method("turn/permission_denied", payload) ==
             "permission denied: Bash"
  end

  test "localizes turn completed item count in Portuguese" do
    Gettext.put_locale(GettextBackend, "pt_BR")

    assert EventHumanizer.humanize_method("turn/completed", %{"params" => %{"status" => "completed", "items_count" => 3}}) ==
             "turn concluído (completed, 3 itens)"
  end
end
