defmodule SymphonyElixir.MixProject do
  use Mix.Project

  def project do
    [
      app: :symphony_elixir,
      version: "0.4.0",
      elixir: "~> 1.19",
      compilers: [:phoenix_live_view] ++ Mix.compilers(),
      start_permanent: Mix.env() == :prod,
      test_coverage: [
        # Elixir 1.19's built-in summary crashes with Enum.EmptyError when all
        # instrumented modules are filtered from a shard. Keep instrumentation
        # enabled for CI, but disable that broken aggregate summary until the
        # upstream tool handles an empty result set.
        summary: false,
        ignore_modules: [
          SymphonyElixir.AgentAvailability,
          SymphonyElixir.Claude.AppServer.StdioMain,
          SymphonyElixir.Claude.Config,
          SymphonyElixir.Codex.Config,
          SymphonyElixir.Config,
          SymphonyElixir.GitHub.Config,
          SymphonyElixir.AgentRouting,
          # Thin GraphQL helpers covered via Bootstrap/Client integration tests
          SymphonyElixir.GitHub.Bootstrap,
          SymphonyElixir.GitHub.Viewer,
          SymphonyElixir.LocalTracker.Viewer,
          SymphonyElixir.LocalTracker.Viewer.Server,
          SymphonyElixir.GitHub.Blockers,
          SymphonyElixir.GitHub.IssueDiscussion,
          SymphonyElixir.GitHub.StateReconciliation,
          SymphonyElixir.Linear.Client,
          SymphonyElixir.Linear.Config,
          # Cloudflare DNS HTTP client; real transport not unit-testable, logic covered via injected transport
          SymphonyElixir.Cloudflare.Dns,
          # Thin Cloudflare DNS CLI wrapper; network/env IO, not unit-tested
          Mix.Tasks.Symphony.Tunnel.Dns,
          SymphonyElixir.LocalTracker.Config,
          SymphonyElixir.Memory.Config,
          SymphonyElixir.Repo,
          SymphonyElixir.Settings.Agents,
          SymphonyElixir.Settings.Group,
          SymphonyElixir.Settings.Setting,
          SymphonyElixir.SpecsCheck,
          SymphonyElixir.Orchestrator,
          SymphonyElixir.Orchestrator.State,
          # OTP boot/supervision wiring; rescue guard only fires on boot-time DB races
          SymphonyElixir.Application,
          # TODO: add tests for ensure_utf8/1 unicode fallback path
          SymphonyElixir.PromptBuilder,
          SymphonyElixir.AgentRunner,
          SymphonyElixir.CLI,
          SymphonyElixir.CodingAgent,
          SymphonyElixir.Claude.CodingAgent,
          SymphonyElixir.Claude.EventHumanizer,
          SymphonyElixir.Claude.ModelCatalog,
          SymphonyElixir.Codex.CodingAgent,
          SymphonyElixir.Codex.DynamicTool,
          SymphonyElixir.Codex.EventHumanizer,
          SymphonyElixir.EventHumanizer,
          SymphonyElixir.EventHumanizer.Text,
          SymphonyElixir.GitHub.Client,
          SymphonyElixir.GitHub.Tracker,
          SymphonyElixir.LocalTracker.Broadcaster,
          SymphonyElixir.LocalTracker.Context,
          SymphonyElixir.LocalTracker.GitHubDiscovery,
          # Shells out to git; cannot be deterministically unit-tested
          SymphonyElixir.LocalTracker.Git,
          # DynamicSupervisor glue that starts a real git-shelling worker
          SymphonyElixir.LocalTracker.CloneSupervisor,
          SymphonyElixir.LocalTracker.IssueMapper,
          SymphonyElixir.LocalTracker.RepositoryScanner,
          SymphonyElixir.LocalTracker.Tracker,
          SymphonyElixir.LocalTracker.WorkflowSuggester,
          SymphonyElixir.Linear.Tracker,
          SymphonyElixir.Terminal.Registry,
          SymphonyElixir.Terminal.Tmux,
          SymphonyElixir.EventHumanizerHelpers,
          SymphonyElixir.HttpServer,
          SymphonyElixir.StatusDashboard,
          SymphonyElixir.LogFile,
          SymphonyElixir.Workspace,
          SymphonyElixirWeb.Endpoint,
          SymphonyElixirWeb.ErrorHTML,
          SymphonyElixirWeb.ErrorJSON,
          SymphonyElixirWeb.Layouts,
          SymphonyElixirWeb.DevEnvPresenter,
          SymphonyElixirWeb.ObservabilityApiController,
          SymphonyElixirWeb.Presenter,
          # Reverse-proxies to live loopback upstream + WS upgrade; guard branches
          # covered by plug tests, proxy path by Task 6 integration.
          SymphonyElixirWeb.PublicHostPlug,
          SymphonyElixirWeb.TerminalChannel,
          SymphonyElixirWeb.Tracker.BlockerController,
          # retry/2 spawns a real git-shelling clone worker; cannot be deterministically unit-tested
          SymphonyElixirWeb.Tracker.CloneJobController,
          SymphonyElixirWeb.Tracker.CommentController,
          SymphonyElixirWeb.Tracker.DevEnvController,
          SymphonyElixirWeb.Tracker.GitHubController,
          SymphonyElixirWeb.Tracker.IssueController,
          SymphonyElixirWeb.Tracker.ProjectController,
          SymphonyElixirWeb.Tracker.ProjectSetupController,
          SymphonyElixirWeb.Tracker.TerminalController,
          SymphonyElixirWeb.TrackerChannel,
          SymphonyElixirWeb.TrackerAuth,
          SymphonyElixirWeb.TrackerErrors,
          SymphonyElixirWeb.TrackerPresenter,
          SymphonyElixirWeb.StaticAssetController,
          SymphonyElixirWeb.StaticAssets,
          SymphonyElixirWeb.Router,
          SymphonyElixirWeb.Router.Helpers,
          SymphonyElixirWeb.UserSocket
        ]
      ],
      test_ignore_filters: [
        "test/support/git_fixtures.exs",
        "test/support/snapshot_support.exs",
        "test/support/test_support.exs"
      ],
      dialyzer: [
        plt_add_apps: [:mix]
      ],
      escript: escript(),
      aliases: aliases(),
      deps: deps()
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      mod: {SymphonyElixir.Application, []},
      extra_applications: [:logger]
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:bandit, "~> 1.8"},
      {:floki, ">= 0.30.0", only: :test},
      {:lazy_html, ">= 0.1.0", only: :test},
      {:ecto_sql, "~> 3.13"},
      {:ecto_sqlite3, "~> 0.20"},
      {:phoenix, "~> 1.8.0"},
      {:phoenix_html, "~> 4.2"},
      {:phoenix_live_view, "~> 1.1.0"},
      {:req, "~> 0.5"},
      {:reverse_proxy_plug, "~> 3.0"},
      {:reverse_proxy_plug_websocket, "~> 0.2"},
      {:websockex, "~> 0.4.3"},
      {:jason, "~> 1.4"},
      {:gettext, "~> 0.26"},
      {:yaml_elixir, "~> 2.12"},
      {:ymlr, "~> 5.0"},
      {:solid, "~> 1.2"},
      {:nimble_options, "~> 1.1"},
      {:ex_nudge, "~> 1.0"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      # Hex 1.4.7 predates OTP 28's :exact_compare warning and crashes while
      # formatting it. Pin the upstream compatibility commit until a release
      # containing it is published.
      {:dialyxir, github: "jeremyjh/dialyxir", ref: "3553678f4d69281ac6db61034bcf35bcb30cfd78", only: [:dev], runtime: false}
    ]
  end

  defp aliases do
    [
      setup: ["deps.get"],
      build: ["escript.build"],
      lint: ["specs.check", "credo --strict --only warning"]
    ]
  end

  defp escript do
    [
      app: nil,
      main_module: SymphonyElixir.CLI,
      name: "symphony",
      path: "bin/symphony"
    ]
  end
end
