defmodule SymphonyElixir.Repo.Migrations.CreateKbPagesFts do
  use Ecto.Migration

  def up do
    execute("""
    CREATE VIRTUAL TABLE kb_pages_fts USING fts5(
      title,
      body,
      content='kb_pages',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    )
    """)

    execute("""
    CREATE TRIGGER kb_pages_ai AFTER INSERT ON kb_pages BEGIN
      INSERT INTO kb_pages_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END
    """)

    execute("""
    CREATE TRIGGER kb_pages_ad AFTER DELETE ON kb_pages BEGIN
      INSERT INTO kb_pages_fts(kb_pages_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
    END
    """)

    execute("""
    CREATE TRIGGER kb_pages_au AFTER UPDATE ON kb_pages BEGIN
      INSERT INTO kb_pages_fts(kb_pages_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
      INSERT INTO kb_pages_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
    END
    """)
  end

  def down do
    execute("DROP TRIGGER IF EXISTS kb_pages_au")
    execute("DROP TRIGGER IF EXISTS kb_pages_ad")
    execute("DROP TRIGGER IF EXISTS kb_pages_ai")
    execute("DROP TABLE IF EXISTS kb_pages_fts")
  end
end
