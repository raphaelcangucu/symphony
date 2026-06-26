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

  @doc """
  Turns a human-supplied asset name into a file-name base that satisfies the
  path segment rule (`^[a-zA-Z0-9._-]+$`): a trailing image extension is dropped,
  accents are stripped, the result is lowercased, and unsupported character runs
  collapse to a single hyphen. Falls back to `"image"` when nothing remains.
  """
  @spec slug_base(String.t()) :: String.t()
  def slug_base(name) when is_binary(name) do
    base =
      name
      |> drop_image_extension()
      |> :unicode.characters_to_nfd_binary()
      |> String.replace(~r/[\x{0300}-\x{036f}]/u, "")
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9._-]+/u, "-")
      |> String.replace(~r/-{2,}/, "-")
      |> String.trim("-")
      |> String.trim(".")

    if base == "", do: "image", else: base
  end

  defp drop_image_extension(name) do
    ext = name |> Path.extname() |> String.downcase()

    if ext in @allowed_extensions or ext == ".jpeg" or ext == ".svg",
      do: Path.rootname(name),
      else: name
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
