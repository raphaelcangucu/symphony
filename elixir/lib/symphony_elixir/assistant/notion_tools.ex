defmodule SymphonyElixir.Assistant.NotionTools do
  @moduledoc """
  Assistant tools for importing Notion pages/databases into temporary Markdown.
  """

  alias SymphonyElixir.Notion.Importer

  @tools ~w(import_notion_page)

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      tool_spec(
        "import_notion_page",
        "Download a Notion page or database by URL into temporary Markdown + assets under /tmp/symphony-notion/. Returns paths for the agent to read; does not write to the KB or create issues.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["url"],
          "properties" => %{
            "url" => %{"type" => "string", "description" => "Full Notion page or database URL."}
          }
        }
      )
    ]
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(tool, arguments, opts \\ [])

  def execute("import_notion_page", %{"url" => url}, _opts) when is_binary(url) do
    case String.trim(url) do
      "" ->
        {:error, {:missing_field, :url}}

      trimmed ->
        case Importer.import_url(trimmed) do
          {:ok, data} ->
            {:ok,
             %{
               tool: "import_notion_page",
               message: "Imported Notion #{data.kind}: #{data.title}",
               data: data
             }}

          {:error, reason} ->
            {:error, reason}
        end
    end
  end

  def execute("import_notion_page", _arguments, _opts), do: {:error, {:missing_field, :url}}

  def execute(tool, _arguments, _opts), do: {:error, {:unsupported_tool, tool}}

  defp tool_spec(name, description, input_schema) do
    %{"name" => name, "description" => description, "inputSchema" => input_schema}
  end
end
