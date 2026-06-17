defmodule SymphonyElixir.Settings.Ui do
  @moduledoc "Operator UI settings (group \"ui\")."

  @behaviour SymphonyElixir.Settings.Group

  alias SymphonyElixir.Settings

  @group "ui"
  @locales ["auto", "en", "pt-BR"]

  @impl true
  def group, do: @group

  @impl true
  def defaults, do: %{"locale" => "auto"}

  @impl true
  def cast("locale", value) when value in @locales, do: {:ok, value}
  def cast(_name, _value), do: :error

  @spec locale() :: String.t()
  def locale do
    case Settings.get(@group, "locale") do
      value when value in @locales -> value
      _ -> Map.fetch!(defaults(), "locale")
    end
  end

  @doc """
  Gettext locale for async delivery (push). `"auto"` has no browser context → `"en"`.
  """
  @spec effective_gettext_locale() :: String.t()
  def effective_gettext_locale do
    case locale() do
      "pt-BR" -> "pt_BR"
      _ -> "en"
    end
  end
end
