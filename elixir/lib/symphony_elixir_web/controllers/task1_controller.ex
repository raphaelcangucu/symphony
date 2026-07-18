defmodule SymphonyElixirWeb.Task1Controller do
  @moduledoc "Renders the SYM-1 task page."

  use Phoenix.Controller, formats: [:html]

  alias Plug.Conn

  @spec index(Conn.t(), map()) :: Conn.t()
  def index(conn, _params) do
    html(conn, """
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>TASK 1</title>
      </head>
      <body>
        <main>
          <h1>TASK 1</h1>
          <pre id="health-json" data-health-url="/api/health">Loading health...</pre>
        </main>
        <script>
          const healthTarget = document.getElementById("health-json");

          fetch(healthTarget.dataset.healthUrl)
            .then((response) => response.json())
            .then((payload) => {
              healthTarget.textContent = JSON.stringify(payload, null, 2);
            })
            .catch(() => {
              healthTarget.textContent = JSON.stringify({status: "unavailable"}, null, 2);
            });
        </script>
      </body>
    </html>
    """)
  end
end
