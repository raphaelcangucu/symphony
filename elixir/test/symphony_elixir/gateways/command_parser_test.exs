defmodule SymphonyElixir.Gateways.CommandParserTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Gateways.CommandParser

  test "parses canonical and portuguese aliases" do
    assert {:command, {:help, %{}}} = CommandParser.parse("/help")
    assert {:command, {:help, %{}}} = CommandParser.parse("/ajuda")
    assert {:command, {:set_agent, %{agent_kind: "claude"}}} = CommandParser.parse("/agente claude")
    assert {:command, {:set_mode, %{mode: "explore", args: []}}} = CommandParser.parse("/modo explore")
    assert {:command, {:new_session, %{}}} = CommandParser.parse("/novo")
    assert {:command, {:stop, %{}}} = CommandParser.parse("/parar")
  end

  test "parses setup and pairing commands" do
    assert {:command, {:setup_pair, %{code: "ABC123"}}} = CommandParser.parse("/symphony_setup ABC123")
    assert {:command, {:project_pair, %{code: "XYZ987"}}} = CommandParser.parse("/symphony_parear XYZ987")
  end

  test "returns plain text for normal messages" do
    assert :plain_text = CommandParser.parse("please inspect the project")
  end

  test "rejects invalid commands without treating them as plain text" do
    assert {:error, :unknown_command} = CommandParser.parse("/doesnotexist")
    assert {:error, :invalid_agent} = CommandParser.parse("/agent gpt4")
    assert {:error, :missing_mode} = CommandParser.parse("/mode")
  end
end
