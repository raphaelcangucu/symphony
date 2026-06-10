defmodule SymphonyElixir.Linear.CommentsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Linear.Comments

  test "create returns the remote comment id" do
    client = fn query, variables, _opts ->
      assert query =~ "commentCreate"
      assert variables == %{issueId: "linear-uuid", body: "## Codex Workpad\nv1"}
      {:ok, %{"data" => %{"commentCreate" => %{"success" => true, "comment" => %{"id" => "cmt-1"}}}}}
    end

    assert {:ok, "cmt-1"} = Comments.create("linear-uuid", "## Codex Workpad\nv1", client: client)
  end

  test "create surfaces graphql failure" do
    client = fn _q, _v, _o -> {:ok, %{"data" => %{"commentCreate" => %{"success" => false}}}} end
    assert {:error, {:linear_comment_create_failed, _}} = Comments.create("id", "b", client: client)
  end

  test "create surfaces transport errors" do
    client = fn _q, _v, _o -> {:error, :nxdomain} end
    assert {:error, :nxdomain} = Comments.create("id", "b", client: client)
  end

  test "update returns the remote comment id" do
    client = fn query, variables, _opts ->
      assert query =~ "commentUpdate"
      assert variables == %{id: "cmt-1", body: "v2"}
      {:ok, %{"data" => %{"commentUpdate" => %{"success" => true, "comment" => %{"id" => "cmt-1"}}}}}
    end

    assert {:ok, "cmt-1"} = Comments.update("cmt-1", "v2", client: client)
  end

  test "update surfaces graphql failure" do
    client = fn _q, _v, _o -> {:ok, %{"data" => %{"commentUpdate" => %{"success" => false}}}} end
    assert {:error, {:linear_comment_update_failed, _}} = Comments.update("cmt-1", "v2", client: client)
  end
end
