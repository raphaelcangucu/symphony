import { ArrowLeft, Mic, SendHorizontal } from "lucide-react-native";
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
import { appendTranscript } from "@/native/dictation";
import { StatusDot } from "@/components/StatusDot";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import type { AssistantMessage, AssistantToolCall, SessionTimelineState } from "./session-reducer";
import type { AssistantApprovalRequest, AssistantUserInputRequest } from "./session-reducer";

type SessionScreenProps = {
  threadId: number;
  timeline: SessionTimelineState;
  onBack(): void;
  onDictate?: (() => Promise<string>) | undefined;
  onApproval(requestId: string | number, action: "approve" | "cancel"): Promise<void>;
  onResumeTurn(): Promise<void>;
  onSend(message: string): Promise<void>;
  onStopTurn(): Promise<void>;
  onSubmitUserInput(requestId: string | number, answers: Record<string, string>): Promise<void>;
  onRetrySeed?: (() => Promise<void>) | undefined;
};

export function SessionScreen({
  threadId,
  timeline,
  onBack,
  onDictate,
  onApproval,
  onResumeTurn,
  onSend,
  onStopTurn,
  onSubmitUserInput,
  onRetrySeed,
}: SessionScreenProps) {
  const { colors } = useAppTheme();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [dictating, setDictating] = useState(false);
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

  async function dictate() {
    if (!onDictate || dictating) return;
    setDictating(true);
    setSendError(null);
    try {
      const transcript = await onDictate();
      setMessage((current) => appendTranscript(current, transcript));
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : "Could not recognize speech");
    } finally {
      setDictating(false);
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
          <TurnControl
            onResumeTurn={onResumeTurn}
            onStopTurn={onStopTurn}
            turnStatus={timeline.turnStatus}
          />
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

        {timeline.pendingApproval ? (
          <ApprovalCard onApproval={onApproval} request={timeline.pendingApproval} />
        ) : null}
        {timeline.pendingUserInput ? (
          <UserInputCard onSubmit={onSubmitUserInput} request={timeline.pendingUserInput} />
        ) : null}

        {timeline.error || sendError ? (
          <View style={styles.errorRow}>
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.statusRed }]}>
              {sendError ?? timeline.error}
            </Text>
            {timeline.error && onRetrySeed ? (
              <Pressable
                accessibilityLabel="Retry first message"
                accessibilityRole="button"
                onPress={() => void onRetrySeed()}
              >
                <Text style={[styles.retry, { color: colors.accent }]}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
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
          {onDictate ? (
            <Pressable
              accessibilityLabel={dictating ? "Listening" : "Dictate message"}
              accessibilityRole="button"
              disabled={dictating || sending}
              onPress={() => void dictate()}
              style={[
                styles.voiceButton,
                { backgroundColor: dictating ? colors.accentSoft : colors.bgPressed },
              ]}
            >
              {dictating ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Mic color={colors.textSecondary} size={20} />
              )}
            </Pressable>
          ) : null}
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

function TurnControl({
  onResumeTurn,
  onStopTurn,
  turnStatus,
}: {
  onResumeTurn(): Promise<void>;
  onStopTurn(): Promise<void>;
  turnStatus: SessionTimelineState["turnStatus"];
}) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const canResume = turnStatus?.canResume === true;
  const canStop = turnStatus?.status === "running";
  if (!canResume && !canStop) return <View style={styles.backButton} />;
  const label = canResume ? "Resume turn" : "Stop turn";
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={busy}
      onPress={() => {
        setBusy(true);
        void (canResume ? onResumeTurn() : onStopTurn()).finally(() => setBusy(false));
      }}
      style={styles.turnControl}
    >
      <Text style={{ color: canResume ? colors.statusGreen : colors.statusRed }}>
        {busy ? "…" : canResume ? "Resume" : "Stop"}
      </Text>
    </Pressable>
  );
}

function ApprovalCard({
  onApproval,
  request,
}: {
  onApproval(requestId: string | number, action: "approve" | "cancel"): Promise<void>;
  request: AssistantApprovalRequest;
}) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (action: "approve" | "cancel") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onApproval(request.requestId, action);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit approval");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={[
        styles.requestCard,
        { backgroundColor: colors.bgRaised, borderColor: colors.statusAmber },
      ]}
    >
      <Text style={[styles.requestTitle, { color: colors.statusAmber }]}>Approval required</Text>
      {request.reason ? (
        <Text style={{ color: colors.textSecondary }}>{request.reason}</Text>
      ) : null}
      {request.command ? (
        <Text style={[styles.command, { color: colors.textPrimary }]}>{request.command}</Text>
      ) : null}
      {request.cwd ? <Text style={{ color: colors.textMuted }}>{request.cwd}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.statusRed }}>
          {error}
        </Text>
      ) : null}
      <View style={styles.requestActions}>
        <RequestButton
          disabled={busy}
          label="Cancel command"
          onPress={() => void decide("cancel")}
          tone="secondary"
        />
        <RequestButton
          disabled={busy}
          label="Approve command"
          onPress={() => void decide("approve")}
          tone="primary"
        />
      </View>
    </View>
  );
}

function UserInputCard({
  onSubmit,
  request,
}: {
  onSubmit(requestId: string | number, answers: Record<string, string>): Promise<void>;
  request: AssistantUserInputRequest;
}) {
  const { colors } = useAppTheme();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = request.questions.every((question) => Boolean(answers[question.id]?.trim()));
  const submit = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(request.requestId, answers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit answers");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={[styles.requestCard, { backgroundColor: colors.bgRaised, borderColor: colors.accent }]}
    >
      <Text style={[styles.requestTitle, { color: colors.accent }]}>Assistant question</Text>
      {request.questions.map((question) => (
        <View key={question.id} style={styles.question}>
          {question.header ? (
            <Text style={[styles.questionHeader, { color: colors.textMuted }]}>
              {question.header}
            </Text>
          ) : null}
          <Text style={{ color: colors.textPrimary }}>{question.question}</Text>
          {question.options?.length ? (
            <View style={styles.requestActions}>
              {question.options.map((option) => (
                <RequestButton
                  key={option.label}
                  label={`Select ${option.label}`}
                  onPress={() =>
                    setAnswers((current) => ({ ...current, [question.id]: option.label }))
                  }
                  selected={answers[question.id] === option.label}
                  tone="secondary"
                />
              ))}
            </View>
          ) : (
            <TextInput
              accessibilityLabel={`Answer ${question.header || question.question}`}
              onChangeText={(answer) =>
                setAnswers((current) => ({ ...current, [question.id]: answer }))
              }
              secureTextEntry={question.isSecret}
              style={[
                styles.answerInput,
                { borderColor: colors.borderStrong, color: colors.textPrimary },
              ]}
              value={answers[question.id] ?? ""}
            />
          )}
        </View>
      ))}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.statusRed }}>
          {error}
        </Text>
      ) : null}
      <RequestButton
        disabled={!complete || busy}
        label="Submit answers"
        onPress={() => void submit()}
        tone="primary"
      />
    </View>
  );
}

function RequestButton({
  disabled = false,
  label,
  onPress,
  selected = false,
  tone,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
  selected?: boolean;
  tone: "primary" | "secondary";
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.requestButton,
        {
          backgroundColor: tone === "primary" || selected ? colors.textPrimary : colors.bgPanel,
          borderColor: selected ? colors.accent : colors.borderStrong,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: tone === "primary" || selected ? colors.bgBase : colors.textPrimary,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
    </Pressable>
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
    flex: 1,
    fontSize: 13,
  },
  errorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  retry: {
    fontSize: 13,
    fontWeight: "700",
  },
  voiceButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  answerInput: {
    borderRadius: radii.sm,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  command: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 13,
  },
  question: { gap: spacing.xs },
  questionHeader: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  requestActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  requestButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  requestCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  requestTitle: { fontSize: 14, fontWeight: "700" },
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
  turnControl: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 64,
  },
});
