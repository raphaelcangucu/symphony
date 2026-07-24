import { ArrowLeft, SendHorizontal } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectionBadge, type ConnectionState } from "@/components/ConnectionBadge";
import { StatusDot } from "@/components/StatusDot";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import type { AssistantMessage, AssistantToolCall, SessionTimelineState } from "./session-reducer";

type SessionScreenProps = {
  threadId: number;
  timeline: SessionTimelineState;
  onBack(): void;
  onSend(message: string): Promise<void>;
};

export function SessionScreen({ threadId, timeline, onBack, onSend }: SessionScreenProps) {
  const { colors } = useAppTheme();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const canSend = Boolean(message.trim()) && !sending;

  async function submit() {
    const normalized = message.trim();
    if (!normalized || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      await onSend(normalized);
      setMessage("");
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : "Could not send message");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.safeArea}
      >
        <View
          style={[
            styles.header,
            { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
          ]}
        >
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.backButton}
          >
            <ArrowLeft color={colors.textPrimary} size={22} />
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Session {threadId}</Text>
            <ConnectionBadge state={connectionState(timeline.connectionState)} />
          </View>
          <View style={styles.backButton} />
        </View>

        <FlatList
          contentContainerStyle={styles.messageListContent}
          data={timeline.messages}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={
            <TimelineFooter
              activeTools={timeline.activeTools}
              streamingText={timeline.streamingText}
            />
          }
          renderItem={({ item }) => <MessageBubble message={item} />}
          style={styles.messageList}
          testID="session-message-list"
        />

        {timeline.error || sendError ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.statusRed }]}>
            {sendError ?? timeline.error}
          </Text>
        ) : null}

        <View
          style={[
            styles.composer,
            { backgroundColor: colors.bgPanel, borderColor: colors.borderStrong },
          ]}
        >
          <TextInput
            accessibilityLabel="Message"
            multiline
            onChangeText={setMessage}
            placeholder="Message"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            style={[styles.input, { color: colors.textPrimary }]}
            value={message}
          />
          <Pressable
            accessibilityLabel={sending ? "Sending" : "Send"}
            accessibilityRole="button"
            disabled={!canSend}
            onPress={() => void submit()}
            style={[
              styles.sendButton,
              { backgroundColor: canSend ? colors.textPrimary : colors.bgPressed },
            ]}
          >
            {sending ? (
              <ActivityIndicator color={colors.bgBase} size="small" />
            ) : (
              <SendHorizontal color={canSend ? colors.bgBase : colors.textMuted} size={20} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ message }: { message: AssistantMessage }) {
  const { colors } = useAppTheme();
  const user = message.role === "user";
  return (
    <View
      style={[
        styles.message,
        {
          alignSelf: user ? "flex-end" : "flex-start",
          backgroundColor: user ? colors.accentSoft : colors.bgPanel,
          borderColor: user ? colors.accent : colors.borderSubtle,
        },
      ]}
    >
      <Text style={[styles.messageRole, { color: colors.textMuted }]}>
        {user ? "You" : roleLabel(message.role)}
      </Text>
      <Text style={[styles.messageText, { color: colors.textPrimary }]}>{message.content}</Text>
      {message.toolCalls.map((tool) => (
        <ToolRow key={tool.id} tool={tool} />
      ))}
    </View>
  );
}

function TimelineFooter({
  activeTools,
  streamingText,
}: {
  activeTools: AssistantToolCall[];
  streamingText: string;
}) {
  const { colors } = useAppTheme();
  if (!streamingText && activeTools.length === 0) return null;
  return (
    <View
      style={[
        styles.message,
        styles.streamingMessage,
        { backgroundColor: colors.bgPanel, borderColor: colors.borderStrong },
      ]}
    >
      {streamingText ? (
        <Text style={[styles.messageText, { color: colors.textPrimary }]}>{streamingText}</Text>
      ) : null}
      {activeTools.map((tool) => (
        <ToolRow key={tool.id} tool={tool} />
      ))}
    </View>
  );
}

function ToolRow({ tool }: { tool: AssistantToolCall }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.tool}>
      <StatusDot tone={tool.status === "running" ? "accent" : "success"} />
      <Text style={[styles.toolName, { color: colors.textSecondary }]}>{tool.name}</Text>
    </View>
  );
}

function connectionState(state: SessionTimelineState["connectionState"]): ConnectionState {
  return state === "reconnecting" ? "connecting" : state;
}

function roleLabel(role: AssistantMessage["role"]): string {
  if (role === "assistant") return "Assistant";
  if (role === "tool") return "Tool";
  return "System";
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  composer: {
    alignItems: "flex-end",
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    margin: spacing.md,
    padding: spacing.xs,
  },
  error: {
    fontSize: 13,
    paddingHorizontal: spacing.md,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 130,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  message: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    maxWidth: "88%",
    padding: spacing.md,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    flexGrow: 1,
    gap: spacing.sm,
    justifyContent: "flex-end",
    padding: spacing.md,
  },
  messageRole: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  messageText: {
    fontSize: 16,
    lineHeight: 23,
  },
  safeArea: {
    flex: 1,
  },
  sendButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  streamingMessage: {
    alignSelf: "flex-start",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  titleBlock: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xxs,
  },
  tool: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  toolName: {
    fontSize: 13,
    fontWeight: "600",
  },
});
