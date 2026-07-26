defmodule SymphonyElixir.MobileRpc.Methods.OrcaTasks do
  @moduledoc "Dev10x-branded task and notification operations backed by the selected Symphony host."

  @spec modules() :: [module()]
  def modules do
    [
      __MODULE__.List,
      __MODULE__.Get,
      __MODULE__.NotificationsSubscribe,
      __MODULE__.NotificationsUnsubscribe
    ]
  end

  defmodule List do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "symphony.tasks.list",
      service: SymphonyElixir.MobileRpc.OrcaTasksService,
      service_key: :orca_tasks_service,
      allowed_keys: ["query", "projectSlugs", "limit"]
  end

  defmodule Get do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "symphony.tasks.get",
      service: SymphonyElixir.MobileRpc.OrcaTasksService,
      service_key: :orca_tasks_service,
      allowed_keys: ["projectSlug", "identifier"],
      required_keys: ["projectSlug", "identifier"]
  end

  defmodule NotificationsSubscribe do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "notifications.subscribe",
      service: SymphonyElixir.MobileRpc.OrcaTasksService,
      service_key: :orca_tasks_service,
      subscription: true,
      allowed_keys: []
  end

  defmodule NotificationsUnsubscribe do
    use SymphonyElixir.MobileRpc.OrcaMethod,
      name: "notifications.unsubscribe",
      service: SymphonyElixir.MobileRpc.OrcaTasksService,
      service_key: :orca_tasks_service,
      allowed_keys: ["subscriptionId"],
      required_keys: ["subscriptionId"]
  end
end
