defmodule SymphonyElixir.SqliteFixtures do
  @moduledoc false

  def create_database!(path) do
    File.mkdir_p!(Path.dirname(path))
    {:ok, conn} = Exqlite.Sqlite3.open(path)
    :ok = Exqlite.Sqlite3.execute(conn, "CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    :ok = Exqlite.Sqlite3.execute(conn, "INSERT INTO fixture (id, value) VALUES (1, 'original')")
    :ok = Exqlite.Sqlite3.close(conn)
    path
  end

  def execute!(path, sql) do
    {:ok, conn} = Exqlite.Sqlite3.open(path)
    :ok = Exqlite.Sqlite3.execute(conn, sql)
    :ok = Exqlite.Sqlite3.close(conn)
    :ok
  end

  def scalar!(path, sql) do
    {:ok, conn} = Exqlite.Sqlite3.open(path)
    {:ok, statement} = Exqlite.Sqlite3.prepare(conn, sql)
    {:row, [value]} = Exqlite.Sqlite3.step(conn, statement)
    :ok = Exqlite.Sqlite3.release(conn, statement)
    :ok = Exqlite.Sqlite3.close(conn)
    value
  end
end
