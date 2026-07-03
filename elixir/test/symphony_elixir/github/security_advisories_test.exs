defmodule SymphonyElixir.GitHub.SecurityAdvisoriesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.SecurityAdvisories

  test "list_for_project returns normalized dependabot alerts and advisories" do
    rest_get = fn
      "/repos/acme/app/dependabot/alerts?" <> query, [] ->
        assert %{"state" => "open", "per_page" => "100"} = URI.decode_query(query)

        {:ok,
         %{
           body: [
             %{
               "number" => 3,
               "state" => "open",
               "html_url" => "https://github.com/acme/app/security/dependabot/3",
               "dependency" => %{"package" => %{"name" => "phoenix"}},
               "security_advisory" => %{
                 "ghsa_id" => "GHSA-abcd-1234",
                 "summary" => "Phoenix advisory",
                 "severity" => "high"
               },
               "updated_at" => "2026-07-03T10:00:00Z"
             }
           ]
         }}

      "/repos/acme/app/security-advisories?" <> query, [] ->
        assert %{"state" => "published", "per_page" => "100"} = URI.decode_query(query)

        {:ok,
         %{
           body: [
             %{
               "ghsa_id" => "GHSA-wxyz-9876",
               "summary" => "Repository advisory",
               "severity" => "critical",
               "state" => "published",
               "html_url" => "https://github.com/acme/app/security/advisories/GHSA-wxyz-9876",
               "updated_at" => "2026-07-03T11:00:00Z"
             }
           ]
         }}
    end

    assert %{
             supported: true,
             dependabot: [
               %{
                 number: 3,
                 repo: "acme/app",
                 state: "open",
                 package: "phoenix",
                 ghsa_id: "GHSA-abcd-1234",
                 severity: "high"
               }
             ],
             advisories: [
               %{
                 ghsa_id: "GHSA-wxyz-9876",
                 repo: "acme/app",
                 state: "published",
                 severity: "critical"
               }
             ]
           } = SecurityAdvisories.list_for_project(["acme/app"], rest_get_fun: rest_get)
  end

  test "list_for_project reports unsupported when no repositories are configured" do
    assert %{supported: false, dependabot: [], advisories: []} =
             SecurityAdvisories.list_for_project([], rest_get_fun: fn _path, _opts -> flunk("not called") end)
  end

  test "list_for_project normalizes all-state security queries" do
    rest_get = fn
      "/repos/acme/app/dependabot/alerts?" <> query, [] ->
        assert %{"state" => "open,dismissed,fixed,auto_dismissed", "per_page" => "100"} = URI.decode_query(query)
        {:ok, %{body: []}}

      "/repos/acme/app/security-advisories?" <> query, [] ->
        assert %{"per_page" => "100"} = URI.decode_query(query)
        refute Map.has_key?(URI.decode_query(query), "state")
        {:ok, %{body: []}}
    end

    assert %{supported: true, dependabot: [], advisories: []} =
             SecurityAdvisories.list_for_project(["acme/app"],
               state: "all",
               advisory_state: "all",
               rest_get_fun: rest_get
             )
  end
end
