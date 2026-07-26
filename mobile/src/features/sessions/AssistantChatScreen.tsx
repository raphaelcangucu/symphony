import { useExternalStoreRuntime } from "@assistant-ui/core/react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ThreadMessageLike,
  useAui,
  useAuiState,
} from "@assistant-ui/react-native";
import {
  ArrowLeft,
  Mic,
  SendHorizontal,
  Square,
  SquareTerminal,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectionBadge, type ConnectionState } from "@/components/ConnectionBadge";
import { StatusDot } from "@/components/StatusDot";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import {
  buildAssistantUiMessages,
  submitAssistantUiMessage,
} from "./assistant-ui-session-adapter";
import type {
  AssistantApprovalRequest,
  AssistantUserInputRequest,
  SessionTimelineState,
} from "./session-reducer";

export type AssistantChatScreenProps = {
  title: string;
  threadId: number;
  timeline: SessionTimelineState;
  onBack(): void;
  onOpenTerminal(): void;
  onDictate?: (() => Promise<string>) | undefined;
  onApproval(requestId: string | number, action: "approve" | "cancel"): Promise<void>;
  onResumeTurn(): Promise<void>;
  onSend(message: string): Promise<void>;
  onStopTurn(): Promise<void>;
  onSubmitUserInput(requestId: string | number, answers: Record<string, string>): Promise<void>;
  onRetrySeed?: (() => Promise<void>) | undefined;
};

export function AssistantChatScreen(props: AssistantChatScreenProps) {
  const messages = useMemo(
    () => buildAssistantUiMessages(props.timeline),
    [props.timeline],
  );
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (message) => message,
    // Symphony accepts a new message while a turn is running and routes it as
    // provider steer (or a durable queued follow-up). Keep the composer live.
    isRunning: false,
    isSendDisabled: props.timeline.connectionState !== "live",
    onNew: (message) => submitAssistantUiMessage(message, props.onSend),
    onCancel: props.onStopTurn,
    onResume: async () => props.onResumeTurn(),
    unstable_capabilities: { copy: true },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantChatContent {...props} />
    </AssistantRuntimeProvider>
  );
}

function AssistantChatContent({
  title,
  threadId,
  timeline,
  onApproval,
  onBack,
  onDictate,
  onOpenTerminal,
  onResumeTurn,
  onRetrySeed,
  onStopTurn,
  onSubmitUserInput,
}: AssistantChatScreenProps) {
  const { colors } = useAppTheme();

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
            style={styles.iconButton}
          >
            <ArrowLeft color={colors.textPrimary} size={22} />
          </Pressable>
          <View style={styles.titleBlock}>
            <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>
              {title || `Session ${threadId}`}
            </Text>
            <View style={styles.titleMeta}>
              <Text style={[styles.sessionId, { color: colors.textMuted }]}>#{threadId}</Text>
              <ConnectionBadge state={connectionState(timeline.connectionState)} />
            </View>
          </View>
          <TurnControl
            onResumeTurn={onResumeTurn}
            onStopTurn={onStopTurn}
            turnStatus={timeline.turnStatus}
          />
          <Pressable
            accessibilityLabel="Open terminal"
            accessibilityRole="button"
            onPress={onOpenTerminal}
            style={styles.iconButton}
          >
            <SquareTerminal color={colors.textPrimary} size={21} />
          </Pressable>
        </View>

        <ThreadPrimitive.Root style={styles.thread}>
          <ThreadPrimitive.Messages
            contentContainerStyle={styles.messageListContent}
            keyboardShouldPersistTaps="handled"
            testID="session-message-list"
          >
            {({ message }) => <ChatMessage role={message.role} />}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>

        {timeline.pendingApproval ? (
          <ApprovalCard onApproval={onApproval} request={timeline.pendingApproval} />
        ) : null}
        {timeline.pendingUserInput ? (
          <UserInputCard onSubmit={onSubmitUserInput} request={timeline.pendingUserInput} />
        ) : null}

        {timeline.error ? (
          <View style={styles.errorRow}>
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.statusRed }]}>
              {timeline.error}
            </Text>
            {onRetrySeed ? (
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

        <ChatComposer onDictate={onDictate} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ChatMessage({ role }: { role: "assistant" | "user" | "system" }) {
  const { colors } = useAppTheme();
  const user = role === "user";
  return (
    <MessagePrimitive.Root
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
        {user ? "You" : role === "assistant" ? "Dev10x" : "System"}
      </Text>
      <MessagePrimitive.Content
        renderReasoning={({ part }) => (
          <View style={[styles.reasoning, { borderColor: colors.borderSubtle }]}>
            <Text style={[styles.reasoningLabel, { color: colors.textMuted }]}>Thinking</Text>
            <Markdown style={markdownStyles(colors)}>{part.text}</Markdown>
          </View>
        )}
        renderText={({ part }) =>
          user ? (
            <Text style={[styles.messageText, { color: colors.textPrimary }]}>{part.text}</Text>
          ) : (
            <Markdown style={markdownStyles(colors)}>{part.text}</Markdown>
          )
        }
        renderToolCall={({ part }) => (
          <View
            style={[
              styles.toolCard,
              { backgroundColor: colors.bgRaised, borderColor: colors.borderStrong },
            ]}
          >
            <View style={styles.toolHeader}>
              <StatusDot tone={part.result === undefined ? "accent" : "success"} />
              <Text style={[styles.toolName, { color: colors.textSecondary }]}>
                {part.toolName}
              </Text>
              <Text style={[styles.toolStatus, { color: colors.textMuted }]}>
                {part.result === undefined ? "Running" : "Done"}
              </Text>
            </View>
            {part.result !== undefined && String(part.result).trim() ? (
              <Text
                numberOfLines={6}
                style={[styles.toolOutput, { color: colors.textSecondary }]}
              >
                {String(part.result)}
              </Text>
            ) : null}
          </View>
        )}
      />
    </MessagePrimitive.Root>
  );
}

function ChatComposer({
  onDictate,
}: {
  onDictate?: (() => Promise<string>) | undefined;
}) {
  const { colors } = useAppTheme();
  const [dictating, setDictating] = useState(false);
  const aui = useAui();
  const composerText = useAuiState((state) => state.composer.text);

  return (
    <ComposerPrimitive.Root
      style={[
        styles.composer,
        { backgroundColor: colors.bgPanel, borderColor: colors.borderStrong },
      ]}
    >
      <ComposerPrimitive.Input
        accessibilityLabel="Message"
        multiline
        placeholder="Message or steer this run…"
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        style={[styles.input, { color: colors.textPrimary }]}
        submitMode="none"
      />
      {onDictate ? (
        <Pressable
          accessibilityLabel={dictating ? "Listening" : "Dictate message"}
          accessibilityRole="button"
          disabled={dictating}
          onPress={() => {
            setDictating(true);
            void onDictate()
              .then((transcript) => {
                const nextText = [composerText.trim(), transcript.trim()]
                  .filter(Boolean)
                  .join(" ");
                if (nextText) aui.composer().setText(nextText);
              })
              .finally(() => setDictating(false));
          }}
          style={[styles.composerButton, { backgroundColor: colors.bgPressed }]}
        >
          {dictating ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Mic color={colors.textSecondary} size={20} />
          )}
        </Pressable>
      ) : null}
      <ComposerPrimitive.Send
        accessibilityLabel="Send"
        accessibilityRole="button"
        style={[styles.composerButton, { backgroundColor: colors.textPrimary }]}
      >
        <SendHorizontal color={colors.bgBase} size={20} />
      </ComposerPrimitive.Send>
      <ComposerPrimitive.Cancel
        accessibilityLabel="Stop generation"
        accessibilityRole="button"
        style={[styles.composerButton, { backgroundColor: colors.bgPressed }]}
      >
        <Square color={colors.statusRed} fill={colors.statusRed} size={15} />
      </ComposerPrimitive.Cancel>
    </ComposerPrimitive.Root>
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
  if (!canResume && !canStop) return null;
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
  const decide = async (action: "approve" | "cancel") => {
    if (busy) return;
    setBusy(true);
    try {
      await onApproval(request.requestId, action);
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
  const complete = request.questions.every((question) => Boolean(answers[question.id]?.trim()));
  return (
    <View
      style={[styles.requestCard, { backgroundColor: colors.bgRaised, borderColor: colors.accent }]}
    >
      <Text style={[styles.requestTitle, { color: colors.accent }]}>Assistant question</Text>
      {request.questions.map((question) => (
        <View key={question.id} style={styles.question}>
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
      <RequestButton
        disabled={!complete || busy}
        label="Submit answers"
        onPress={() => {
          setBusy(true);
          void onSubmit(request.requestId, answers).finally(() => setBusy(false));
        }}
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

function connectionState(state: SessionTimelineState["connectionState"]): ConnectionState {
  return state === "reconnecting" ? "connecting" : state;
}

function markdownStyles(colors: ReturnType<typeof useAppTheme>["colors"]) {
  return {
    body: { color: colors.textPrimary, fontSize: 16, lineHeight: 23, margin: 0 },
    code_inline: {
      backgroundColor: colors.bgRaised,
      color: colors.textPrimary,
      fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    },
    code_block: {
      backgroundColor: colors.bgRaised,
      borderColor: colors.borderStrong,
      color: colors.textPrimary,
      fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    },
    fence: {
      backgroundColor: colors.bgRaised,
      borderColor: colors.borderStrong,
      color: colors.textPrimary,
      fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    },
    link: { color: colors.accent },
  };
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  thread: { flex: 1 },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  titleBlock: { alignItems: "center", flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: "700", maxWidth: "100%" },
  titleMeta: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  sessionId: { fontSize: 11 },
  turnControl: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 54,
  },
  messageListContent: {
    flexGrow: 1,
    gap: spacing.sm,
    justifyContent: "flex-end",
    padding: spacing.md,
  },
  message: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    maxWidth: "92%",
    padding: spacing.md,
  },
  messageRole: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  messageText: { fontSize: 16, lineHeight: 23 },
  reasoning: {
    borderLeftWidth: 2,
    gap: spacing.xxs,
    paddingLeft: spacing.sm,
  },
  reasoningLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  toolCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  toolHeader: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  toolName: { flex: 1, fontSize: 13, fontWeight: "700" },
  toolStatus: { fontSize: 11 },
  toolOutput: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    lineHeight: 17,
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
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 130,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  composerButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  error: { flex: 1, fontSize: 13 },
  errorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  retry: { fontSize: 13, fontWeight: "700" },
  requestCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  requestTitle: { fontSize: 14, fontWeight: "700" },
  requestActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  requestButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  command: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 13,
  },
  question: { gap: spacing.xs },
  answerInput: {
    borderRadius: radii.sm,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
});
