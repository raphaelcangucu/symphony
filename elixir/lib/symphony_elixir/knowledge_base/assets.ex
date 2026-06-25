defmodule SymphonyElixir.KnowledgeBase.Assets do
  @moduledoc """
  Validation and naming for knowledge base assets stored under `docs/assets/`.
  Limits mirror the assistant `AttachmentStore` image constraints.
  """

  @max_bytes 4 * 1024 * 1024
  @allowed_extensions ~w(.png .jpg .jpeg .gif .webp)

  @spec validate(String.t(), non_neg_integer()) ::
          {:ok, String.t()} | {:error, :kb_unsupported_asset | :kb_asset_too_large}
  def validate(filename, size_bytes) when is_binary(filename) and is_integer(size_bytes) do
    ext = filename |> Path.extname() |> String.downcase() |> normalize_ext()

    cond do
      ext not in @allowed_extensions -> {:error, :kb_unsupported_asset}
      size_bytes > @max_bytes -> {:error, :kb_asset_too_large}
      true -> {:ok, ext}
    end
  end

  @spec content_name(binary(), String.t()) :: String.t()
  def content_name(bytes, ext) when is_binary(bytes) and is_binary(ext) do
    digest = :crypto.hash(:sha256, bytes) |> Base.encode16(case: :lower)
    digest <> ext
  end

  @spec relative_link(String.t(), String.t()) :: String.t()
  def relative_link(page_rel_path, asset_rel_path) do
    page_dir = Path.dirname(page_rel_path)

    if page_dir in [".", ""],
      do: asset_rel_path,
      else: Path.relative_to(asset_rel_path, page_dir, force: true)
  end

  defp normalize_ext(".jpeg"), do: ".jpg"
  defp normalize_ext(ext), do: ext
end
