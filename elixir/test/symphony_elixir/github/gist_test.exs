defmodule SymphonyElixir.GitHub.GistTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.Gist

  test "share creates a gist and returns urls" do
    previous = Application.get_env(:symphony_elixir, :github_token)
    System.put_env("GITHUB_TOKEN", "test-token")
    on_exit(fn ->
      if previous, do: System.put_env("GITHUB_TOKEN", previous), else: System.delete_env("GITHUB_TOKEN")
    end)

    request_fun = fn url, _headers, _body ->
      assert url == "https://api.github.com/gists"

      {:ok,
       %{
         status: 201,
         body: %{
           "id" => "abc123",
           "html_url" => "https://gist.github.com/you/abc123",
           "files" => %{
             "gamba.yaml" => %{
               "filename" => "gamba.yaml",
               "raw_url" => "https://gist.githubusercontent.com/you/abc123/raw/gamba.yaml"
             }
           }
         }
       }}
    end

    assert {:ok, info} =
             Gist.share("gamba", "kind: symphony_project\n",
               request_fun: request_fun
             )

    assert info.gist_id == "abc123"
    assert info.html_url =~ "gist.github.com"
    assert info.raw_url =~ "gist.githubusercontent.com"
  end
end
