# Comment @mentions + Web Push Implementation Plan

**Goal:** Let operators @mention project users in issue comments and deliver targeted Web Push notifications only after the comment syncs to the remote tracker (or immediately on local-only projects).

**Architecture:** Parse `@login` from comment body, resolve against `tracker_users`, store operator identity keys on push subscriptions, and dispatch mention pushes from `MentionNotifier` when `sync_status` transitions `pending → synced` (or comment is born `synced`). Frontend adds `@` autocomplete to `CommentsTab` using existing `getIssueFormOptions` assignees.

**Tech Stack:** Elixir/Ecto, `ex_nudge`, Phoenix tracker API, React/TypeScript (`CommentsTab`), Vitest.

---

### Task 1: Push subscription identity keys

**Files:**
- Create: `elixir/priv/repo/migrations/20260624120000_add_identity_keys_to_push_subscriptions.exs`
- Modify: `elixir/lib/symphony_elixir/push_notifications/subscription.ex`
- Modify: `elixir/lib/symphony_elixir/push_notifications/subscriptions.ex`
- Modify: `elixir/lib/symphony_elixir_web/controllers/tracker/push_controller.ex`
- Test: `elixir/test/symphony_elixir_web/controllers/tracker/push_controller_test.exs`

- [ ] **Step 1: Write migration**

```elixir
defmodule SymphonyElixir.Repo.Migrations.AddIdentityKeysToPushSubscriptions do
  use Ecto.Migration

  def change do
    alter table(:push_subscriptions) do
      add :identity_keys, {:array, :string}, default: []
    end
  end
end
```

- [ ] **Step 2: Write failing test**

```elixir
test "create stores identity_keys from connected identities", %{conn: conn} do
  # stub Identity.statuses or use test env with known viewer
  conn =
    post(conn, ~p"/api/tracker/v1/push/subscriptions", %{
      "endpoint" => "https://push.example/1",
      "keys" => %{"p256dh" => "k", "auth" => "a"}
    })

  assert %{"data" => %{"identity_keys" => keys}} = json_response(conn, 201)
  assert is_list(keys)
end
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `cd elixir && mix test test/symphony_elixir_web/controllers/tracker/push_controller_test.exs`
Expected: FAIL (identity_keys missing)

- [ ] **Step 4: Implement**

In `Subscription` schema add `field(:identity_keys, {:array, :string}, default: [])` and cast in changeset.

Add `PushNotifications.IdentityKeys.collect/0`:

```elixir
defmodule SymphonyElixir.PushNotifications.IdentityKeys do
  @moduledoc false

  alias SymphonyElixir.LocalTracker.Viewer
  alias SymphonyElixir.Tracker.Identity

  @spec collect() :: [String.t()]
  def collect do
    identity_keys =
      Identity.statuses()
      |> Enum.flat_map(fn
        %{connected: true, identity: identity} when not is_nil(identity) ->
          [identity.match_value, identity.login, identity.name]

        _ ->
          []
      end)

  viewer_keys =
    case Viewer.current() do
      {:ok, %{login: login}} when is_binary(login) -> [login]
      _ -> []
    end

    (identity_keys ++ viewer_keys)
    |> Enum.map(&normalize/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp normalize(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: String.downcase(trimmed)
  end

  defp normalize(_), do: nil
end
```

In `PushController.create`, merge `identity_keys: IdentityKeys.collect()` into upsert attrs.

Add `Subscriptions.list_for_identities(keys)`:

```elixir
def list_for_identities(keys) when is_list(keys) do
  normalized = keys |> Enum.map(&String.downcase/1) |> Enum.reject(&(&1 == ""))

  if normalized == [] do
    []
  else
    from(s in Subscription,
      where: fragment("? && ?", s.identity_keys, ^normalized)
    )
    |> Repo.all()
  end
end
```

SQLite array overlap: use `Enum.any` filter in Elixir if fragment is awkward — acceptable for small subscription counts:

```elixir
def list_for_identities(keys) when is_list(keys) do
  wanted = MapSet.new(normalized_keys(keys))

  list()
  |> Enum.filter(fn sub ->
    sub.identity_keys
    |> normalized_keys()
    |> Enum.any?(fn key -> MapSet.member?(wanted, key) end)
  end)
end
```

- [ ] **Step 5: Run test — PASS**

- [ ] **Step 6: Commit**

```bash
git add elixir/priv/repo/migrations/20260624120000_add_identity_keys_to_push_subscriptions.exs \
  elixir/lib/symphony_elixir/push_notifications/subscription.ex \
  elixir/lib/symphony_elixir/push_notifications/subscriptions.ex \
  elixir/lib/symphony_elixir/push_notifications/identity_keys.ex \
  elixir/lib/symphony_elixir_web/controllers/tracker/push_controller.ex \
  elixir/test/symphony_elixir_web/controllers/tracker/push_controller_test.exs
git commit -m "feat(push): store operator identity keys on subscriptions"
```

---

### Task 2: MentionParser

**Files:**
- Create: `elixir/lib/symphony_elixir/push_notifications/mention_parser.ex`
- Test: `elixir/test/symphony_elixir/push_notifications/mention_parser_test.exs`

- [ ] **Step 1: Write failing tests**

```elixir
defmodule SymphonyElixir.PushNotifications.MentionParserTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PushNotifications.MentionParser

  test "parse_logins/1 extracts @mentions" do
    assert ["raphael", "bob"] = MentionParser.parse_logins("Hi @raphael and @bob")
    assert [] = MentionParser.parse_logins("email@domain.com")
  end

  test "identity_keys_for_user/1 returns normalized keys" do
    user = %{login: "Raphael", remote_id: "U1", name: "Raphael C"}
    assert MapSet.new(["raphael", "u1", "raphael c"]) == MapSet.new(MentionParser.identity_keys_for_user(user))
  end
end
```

- [ ] **Step 2: Run — FAIL**

Run: `cd elixir && mix test test/symphony_elixir/push_notifications/mention_parser_test.exs`

- [ ] **Step 3: Implement**

```elixir
defmodule SymphonyElixir.PushNotifications.MentionParser do
  @moduledoc false

  import Ecto.Query

  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.UserRecord

  @mention_regex ~r/(?<!\w)@([a-zA-Z0-9_-]+)/

  @spec parse_logins(String.t()) :: [String.t()]
  def parse_logins(body) when is_binary(body) do
    @mention_regex
    |> Regex.scan(body)
    |> Enum.map(fn [_, login] -> String.downcase(login) end)
    |> Enum.uniq()
  end

  def parse_logins(_), do: []

  @spec resolve_users(integer(), [String.t()]) :: [UserRecord.t()]
  def resolve_users(project_id, logins) when is_integer(project_id) and is_list(logins) do
    normalized = logins |> Enum.map(&String.downcase/1) |> Enum.reject(&(&1 == ""))

    if normalized == [] do
      []
    else
      UserRecord
      |> where([u], u.project_id == ^project_id)
      |> where([u], fragment("lower(?)", u.login) in ^normalized)
      |> Repo.all()
    end
  end

  @spec identity_keys_for_user(UserRecord.t() | map()) :: [String.t()]
  def identity_keys_for_user(user) do
    [Map.get(user, :login), Map.get(user, :remote_id), Map.get(user, :name)]
    |> Enum.map(&normalize/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp normalize(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: String.downcase(trimmed)
  end

  defp normalize(_), do: nil
end
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

---

### Task 3: Sender.deliver_to_identities + Dispatcher.comment_mentioned

**Files:**
- Modify: `elixir/lib/symphony_elixir/push_notifications/sender.ex`
- Modify: `elixir/lib/symphony_elixir/push_notifications/dispatcher.ex`
- Modify: `elixir/priv/gettext/en/LC_MESSAGES/push.po` (and default locale if present)
- Test: `elixir/test/symphony_elixir/push_notifications/dispatcher_test.exs`
- Test: `elixir/test/symphony_elixir/push_notifications/sender_test.exs` (create if needed)

- [ ] **Step 1: Write failing Dispatcher test**

```elixir
test "comment_mentioned builds payload with author and snippet" do
  project = %Project{slug: "gamba"}
  issue = %IssueRecord{identifier: "GAM-5", title: "Fix bug"}
  comment = %Comment{id: 42, body: "Please review @raphael", author: "bob"}

  assert :ok =
    Dispatcher.comment_mentioned(project, issue, comment, [
      %{login: "raphael", remote_id: "U1", name: nil}
    ])

  # assert notify called with kind comment_mention and tag comment_mention:gamba:GAM-5:42
end
```

- [ ] **Step 2: Implement Sender**

```elixir
@spec deliver_to_identities([String.t()], String.t(), map()) :: :ok
def deliver_to_identities(identity_keys, kind, payload)
    when is_list(identity_keys) and is_binary(kind) and is_map(payload) do
  body =
    payload
    |> Map.put("kind", kind)
    |> Jason.encode!()

  Subscriptions.list_for_identities(identity_keys)
  |> Enum.each(&deliver_one(&1, body))

  :ok
end
```

- [ ] **Step 3: Implement Dispatcher.comment_mentioned/4**

```elixir
@comment_mention_kind "comment_mention"

@spec comment_mentioned(Project.t(), IssueRecord.t(), Comment.t(), [map()]) :: :ok
def comment_mentioned(%Project{} = project, %IssueRecord{} = issue, %Comment{} = comment, mentioned_users)
    when is_list(mentioned_users) do
  slug = project.slug
  identifier = issue.identifier

  with true <- is_binary(slug) and slug != "",
       true <- is_binary(identifier) and identifier != "" do
    author_keys = author_identity_keys(comment.author)
    snippet = comment_snippet(comment.body)

    Enum.each(mentioned_users, fn user ->
      target_keys = MentionParser.identity_keys_for_user(user)

      if Enum.any?(target_keys, &(&1 in author_keys)) do
        :ok
      else
        with_push_locale(fn ->
          title =
            dgettext("push", "%{author} mentioned you",
              author: comment.author || dgettext("push", "Someone")
            )

          notify_to_identities(target_keys, @comment_mention_kind, %{
            title: title,
            body: "#{identifier}: #{snippet}",
            url: issue_url(slug, identifier),
            tag: "comment_mention:#{slug}:#{identifier}:#{comment.id}"
          })
        end)
      end
    end)
  else
    _ -> :ok
  end
end

defp notify_to_identities(keys, kind, payload) do
  if Config.enabled?() do
    Sender.deliver_to_identities(keys, kind, payload)
  else
    :ok
  end
end
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

---

### Task 4: MentionNotifier + sync hooks

**Files:**
- Create: `elixir/lib/symphony_elixir/push_notifications/mention_notifier.ex`
- Modify: `elixir/lib/symphony_elixir/tracker/sync/local_store.ex` (`mark_comment_sync_status/2`)
- Modify: `elixir/lib/symphony_elixir/local_tracker/context.ex` (`add_comment/4` local-only path)
- Test: `elixir/test/symphony_elixir/push_notifications/mention_notifier_test.exs`
- Test: `elixir/test/symphony_elixir/tracker/sync/engine_comment_sync_test.exs`

- [ ] **Step 1: Write failing MentionNotifier test**

```elixir
test "deliver_if_needed skips workpad comments" do
  comment = %Comment{kind: "workpad", body: "@raphael", sync_status: "synced"}
  assert :ok = MentionNotifier.deliver_if_needed(comment, :after_remote_sync)
  # assert Dispatcher not called
end

test "deliver_if_needed on pending→synced comment with mention" do
  # setup project, issue, user in tracker_users, comment with @raphael
  assert :ok = MentionNotifier.deliver_if_needed(comment, :after_remote_sync)
end
```

- [ ] **Step 2: Implement MentionNotifier**

```elixir
defmodule SymphonyElixir.PushNotifications.MentionNotifier do
  @moduledoc false

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.{Comment, IssueRecord, Project}
  alias SymphonyElixir.PushNotifications.{Dispatcher, MentionParser}
  alias SymphonyElixir.Repo

  @spec deliver_if_needed(Comment.t(), :after_remote_sync | :local_only) :: :ok
  def deliver_if_needed(%Comment{kind: "comment", sync_status: "synced"} = comment, _reason) do
    with %IssueRecord{} = issue <- Repo.get(IssueRecord, comment.issue_id),
         %Project{} = project <- Repo.get(Project, issue.project_id) do
      logins = MentionParser.parse_logins(comment.body)

      mentioned =
        project.id
        |> MentionParser.resolve_users(logins)

      Dispatcher.comment_mentioned(project, issue, comment, mentioned)
    else
      _ -> :ok
    end
  end

  def deliver_if_needed(_comment, _reason), do: :ok
end
```

- [ ] **Step 3: Hook LocalStore.mark_comment_sync_status**

```elixir
def mark_comment_sync_status(comment_id, "synced") when is_integer(comment_id) do
  comment = Repo.get!(Comment, comment_id)
  previous = comment.sync_status

  with {:ok, updated} <- update_status(comment, "synced") do
    if previous == "pending" do
      MentionNotifier.deliver_if_needed(updated, :after_remote_sync)
    end

    {:ok, updated}
  end
end
```

(Read existing `mark_comment_sync_status` and integrate without breaking return shape.)

- [ ] **Step 4: Hook Context.add_comment for local-only**

After `tap_comment_event`, when comment `sync_status == "synced"` and project does not enqueue remote comment sync (tracker without remote adapter or local-only slug path), call `MentionNotifier.deliver_if_needed(comment, :local_only)`.

Helper: `Project.remote_comment_sync?(project)` — false when `IssueAdapter.remote_for(project.tracker_kind)` is nil or remote `add_comment` is unsupported. Simplest v1 check: `sync_status == "synced"` immediately after insert **and** comment was not marked pending by LocalFirstAdapter — detect via `comment.sync_status == "synced"` at end of `Context.add_comment` only (LocalFirstAdapter always sets pending before outbox).

```elixir
# in tap_comment_event after broadcast:
if comment.sync_status == "synced" do
  MentionNotifier.deliver_if_needed(comment, :local_only)
end
```

- [ ] **Step 5: Extend engine integration test**

In `engine_comment_sync_test.exs`, after successful push assert mention notifier invoked (trace Dispatcher.comment_mentioned or count push calls with test subscription).

- [ ] **Step 6: Run tests**

Run: `cd elixir && mix test test/symphony_elixir/push_notifications/ test/symphony_elixir/tracker/sync/engine_comment_sync_test.exs`

- [ ] **Step 7: Commit**

---

### Task 5: Frontend @mention autocomplete

**Files:**
- Create: `tracker/src/hooks/useCommentMentions.ts`
- Create: `tracker/src/components/issues/issue-detail/MentionAutocomplete.tsx`
- Modify: `tracker/src/components/issues/issue-detail/CommentsTab.tsx`
- Create: `tracker/src/components/issues/issue-detail/__tests__/CommentMentions.test.tsx`
- Modify: `tracker/locales/en/tracker.json` (if new strings needed)

- [ ] **Step 1: Write failing test**

```tsx
it("opens mention list when typing @ and inserts selected login", async () => {
  render(<CommentsTab ... assignees={[{ login: "raphael", id: "1", name: "Raphael", avatarUrl: null }]} />);
  const textarea = screen.getByRole("textbox");
  await userEvent.type(textarea, "Hi @ra");
  expect(screen.getByText("raphael")).toBeInTheDocument();
  await userEvent.click(screen.getByText("raphael"));
  expect(textarea).toHaveValue("Hi @raphael ");
});
```

- [ ] **Step 2: Implement useCommentMentions**

Track textarea ref, on change detect `@` token before cursor, return `{ open, query, replaceMention(login) }`.

- [ ] **Step 3: Implement MentionAutocomplete dropdown**

Position below caret (or fixed below textarea for v1 simplicity). Filter assignees by `matchesPickerSearch`.

- [ ] **Step 4: Wire CommentsTab**

- Load assignees via `getIssueFormOptions(projectSlug)` once (same as SummaryTab).
- Pass to composer only (create form v1; edit follow-up).
- Keyboard: ArrowUp/Down, Enter, Escape.

- [ ] **Step 5: Run tests**

Run: `cd tracker && npm test -- CommentMentions`

- [ ] **Step 6: Commit**

---

### Task 6: End-to-end verification

- [ ] **Step 1: Manual smoke**

1. Enable push in Settings (two browsers / two operators if possible).
2. Post comment `@otheruser` on gamba issue.
3. Confirm badge goes `pending → synced`.
4. Confirm mentioned user receives push with deep link.
5. Confirm author does not receive push for self-mention.

- [ ] **Step 2: Run full gates**

Run: `cd elixir && make all`
Run: `cd tracker && npm test`

- [ ] **Step 3: Update push design spec cross-reference**

Add follow-up bullet in `docs/superpowers/specs/2026-06-12-browser-push-notifications-design.md` pointing to this feature.
