import { useExternalStoreRuntime } from "@assistant-ui/core/react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ThreadMessage,
  type ThreadMessageLike,
  useAui,
  useAuiState,
} from "@assistant-ui/react-native";
import {
  ArrowLeft,
  Brain,
  ChevronDown,
  ChevronRight,
  Info,
  Mic,
  SendHorizontal,
  SquareTerminal,
} from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
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
import Markdown from "react-native-markdown-display";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConnectionBadge, type ConnectionState } from "@/components/ConnectionBadge";
import { StatusDot } from "@/components/StatusDot";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

import { buildAssistantUiMessages, submitAssistantUiMessage } from "./assistant-ui-session-adapter";
import { followLatestMessage } from "./chat-scroll";
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
  const messages = useMemo(() => buildAssistantUiMessages(props.timeline), [props.timeline]);
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
  const messageList = useRef<FlatList<ThreadMessage>>(null);

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
            onContentSizeChange={() => followLatestMessage(messageList.current)}
            ref={messageList}
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
  const system = role === "system";
  return (
    <MessagePrimitive.Root
      testID={`chat-message-${role}`}
      style={[
        styles.message,
        user ? styles.userMessage : system ? styles.activityMessage : styles.assistantMessage,
        {
          alignSelf: user ? "flex-end" : "stretch",
          backgroundColor: user ? colors.accentSoft : "transparent",
          borderColor: user ? colors.accent : "transparent",
        },
      ]}
    >
      <MessagePrimitive.Content
        renderReasoning={({ part }) => (
          <ActivityDisclosure icon="reasoning" text={`Thinking\n\n${part.text}`} />
        )}
        renderText={({ part }) =>
          user ? (
            <Text style={[styles.messageText, { color: colors.textPrimary }]}>{part.text}</Text>
          ) : system ? (
            <ActivityDisclosure icon={activityIcon(part.text)} text={part.text} />
          ) : (
            <Markdown style={markdownStyles(colors)}>{part.text}</Markdown>
          )
        }
        renderToolCall={({ part }) => <ToolActivity part={part} />}
      />
    </MessagePrimitive.Root>
  );
}

function activityIcon(text: string): "reasoning" | "system" {
  const title = text
    .split(/\n\s*\n/, 1)[0]
    ?.trim()
    .toLowerCase();
  return title === "reasoning" || title === "thinking" ? "reasoning" : "system";
}

function ActivityDisclosure({ icon, text }: { icon: "reasoning" | "system"; text: string }) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const { title, body } = disclosureText(text, icon === "reasoning" ? "Thinking" : "System");
  const Icon = icon === "reasoning" ? Brain : Info;
  const canExpand = body.length > 0;

  return (
    <View style={styles.activityDisclosure}>
      <Pressable
        accessibilityLabel={`${expanded ? "Hide" : "Show"} ${title} details`}
        accessibilityRole="button"
        disabled={!canExpand}
        onPress={() => setExpanded((current) => !current)}
        style={styles.activityHeader}
      >
        <Icon color={colors.textMuted} size={15} />
        <Text numberOfLines={1} style={[styles.activityTitle, { color: colors.textSecondary }]}>
          {title}
        </Text>
        <Text style={[styles.activityMeta, { color: colors.textMuted }]}>
          {icon === "reasoning" ? "Reasoning" : "System"}
        </Text>
        {canExpand ? (
          expanded ? (
            <ChevronDown color={colors.textMuted} size={15} />
          ) : (
            <ChevronRight color={colors.textMuted} size={15} />
          )
        ) : null}
      </Pressable>
      {expanded && body ? (
        <View style={[styles.activityBody, { borderColor: colors.borderSubtle }]}>
          <Markdown style={activityMarkdownStyles(colors)}>{body}</Markdown>
        </View>
      ) : null}
    </View>
  );
}

function ToolActivity({
  part,
}: {
  part: {
    toolName: string;
    result?: unknown;
  };
}) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const output = part.result === undefined ? "" : String(part.result).trim();
  const running = part.result === undefined;

  return (
    <View
      style={[
        styles.toolCard,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
      ]}
    >
      <Pressable
        accessibilityLabel={`${expanded ? "Hide" : "Show"} ${part.toolName} details`}
        accessibilityRole="button"
        disabled={!output}
        onPress={() => setExpanded((current) => !current)}
        style={styles.toolHeader}
      >
        <StatusDot tone={running ? "accent" : "success"} />
        <Text numberOfLines={1} style={[styles.toolName, { color: colors.textSecondary }]}>
          {part.toolName}
        </Text>
        <Text style={[styles.toolStatus, { color: colors.textMuted }]}>
          {running ? "Running" : "Done"}
        </Text>
        {output ? (
          expanded ? (
            <ChevronDown color={colors.textMuted} size={15} />
          ) : (
            <ChevronRight color={colors.textMuted} size={15} />
          )
        ) : null}
      </Pressable>
      {expanded && output ? (
        <Text
          selectable
          style={[
            styles.toolOutput,
            { borderColor: colors.borderSubtle, color: colors.textSecondary },
          ]}
        >
          {output}
        </Text>
      ) : null}
    </View>
  );
}

function disclosureText(text: string, fallbackTitle: string): { title: string; body: string } {
  const trimmed = text.trim();
  if (!trimmed) return { title: fallbackTitle, body: "" };
  const divider = trimmed.search(/\n\s*\n/);
  if (divider < 0) return { title: trimmed, body: "" };
  return {
    title: trimmed.slice(0, divider).trim() || fallbackTitle,
    body: trimmed.slice(divider).trim(),
  };
}

function ChatComposer({ onDictate }: { onDictate?: (() => Promise<string>) | undefined }) {
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
                const nextText = [composerText.trim(), transcript.trim()].filter(Boolean).join(" ");
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
    body: { color: colors.textPrimary, fontSize: 15.5, lineHeight: 23, margin: 0 },
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

function activityMarkdownStyles(colors: ReturnType<typeof useAppTheme>["colors"]) {
  const base = markdownStyles(colors);
  return {
    ...base,
    body: { ...base.body, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
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
    gap: spacing.md,
    justifyContent: "flex-end",
    padding: spacing.md,
  },
  message: {
    maxWidth: "100%",
  },
  userMessage: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "92%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  assistantMessage: {
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xs,
    width: "100%",
  },
  activityMessage: { paddingVertical: spacing.xxs, width: "100%" },
  messageText: { fontSize: 16, lineHeight: 23 },
  activityDisclosure: { width: "100%" },
  activityHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.xs,
  },
  activityTitle: { flex: 1, fontSize: 13, fontWeight: "600" },
  activityMeta: { fontSize: 11 },
  activityBody: {
    borderLeftWidth: 2,
    marginLeft: spacing.sm,
    paddingBottom: spacing.xs,
    paddingLeft: spacing.md,
    paddingTop: spacing.xs,
  },
  toolCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  toolName: { flex: 1, fontSize: 13, fontWeight: "700" },
  toolStatus: { fontSize: 11 },
  toolOutput: {
    borderTopWidth: StyleSheet.hairlineWidth,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    lineHeight: 17,
    maxHeight: 220,
    padding: spacing.sm,
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
