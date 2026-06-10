defmodule SymphonyElixir.Linear.UploadsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Linear.Uploads

  @moduletag :tmp_dir

  setup %{tmp_dir: tmp_dir} do
    path = Path.join(tmp_dir, "screen.png")
    File.write!(path, "the-bytes")
    %{path: path}
  end

  test "requests a signed upload, PUTs the bytes, returns the assetUrl", %{path: path} do
    graphql = fn _query, variables, _opts ->
      assert variables["filename"] == "screen.png"
      assert variables["contentType"] == "image/png"
      assert variables["size"] == byte_size("the-bytes")
      assert variables["makePublic"] == true

      {:ok,
       %{
         "data" => %{
           "fileUpload" => %{
             "success" => true,
             "uploadFile" => %{
               "uploadUrl" => "https://upload.linear.app/signed",
               "assetUrl" => "https://uploads.linear.app/screen.png",
               "headers" => [%{"key" => "x-amz-acl", "value" => "public-read"}]
             }
           }
         }
       }}
    end

    put = fn url, headers, body ->
      assert url == "https://upload.linear.app/signed"
      assert {"x-amz-acl", "public-read"} in headers
      assert body == "the-bytes"
      :ok
    end

    assert {:ok, "https://uploads.linear.app/screen.png"} =
             Uploads.upload(path, "screen.png", "image/png", graphql: graphql, put: put)
  end

  test "surfaces a fileUpload failure", %{path: path} do
    graphql = fn _q, _v, _o -> {:ok, %{"data" => %{"fileUpload" => %{"success" => false}}}} end
    put = fn _u, _h, _b -> flunk("must not PUT when fileUpload fails") end

    assert {:error, {:linear_file_upload_failed, _}} =
             Uploads.upload(path, "screen.png", "image/png", graphql: graphql, put: put)
  end

  test "surfaces a PUT failure", %{path: path} do
    graphql = fn _q, _v, _o ->
      {:ok,
       %{
         "data" => %{
           "fileUpload" => %{
             "success" => true,
             "uploadFile" => %{"uploadUrl" => "u", "assetUrl" => "a", "headers" => []}
           }
         }
       }}
    end

    put = fn _u, _h, _b -> {:error, {:linear_upload_status, 403}} end

    assert {:error, {:linear_upload_status, 403}} =
             Uploads.upload(path, "screen.png", "image/png", graphql: graphql, put: put)
  end
end
