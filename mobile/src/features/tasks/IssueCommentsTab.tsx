import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import type { IssueComment } from "@/api/contracts";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";

export function IssueCommentsTab({
  comments,
  onAddComment,
}: {
  comments: IssueComment[];
  onAddComment(body: string): void;
}) {
  const { colors } = useAppTheme();
  const [comment, setComment] = useState("");
  const visibleComments = comments.filter((item) => item.kind !== "workpad");

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.srOnly}>Task comments</Text>
      <View style={styles.heading}>
        <View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Conversation</Text>
          <Text style={{ color: colors.textMuted }}>
            {visibleComments.length === 1 ? "1 comment" : `${visibleComments.length} comments`}
          </Text>
        </View>
      </View>

      {visibleComments.map((item) => (
        <View
          key={item.id}
          style={[
            styles.comment,
            { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
          ]}
        >
          <View style={styles.authorRow}>
            <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
              <Text style={{ color: colors.accent, fontWeight: "800" }}>
                {(item.author ?? "?").slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.grow}>
              <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>
                {item.author ?? "Unknown"}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {formatTimestamp(item.createdAt || item.updatedAt)}
              </Text>
            </View>
          </View>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{item.body}</Text>
        </View>
      ))}

      <View
        style={[
          styles.composer,
          { backgroundColor: colors.bgPanel, borderColor: colors.borderSubtle },
        ]}
      >
        <TextInput
          accessibilityLabel="New comment"
          multiline
          onChangeText={setComment}
          placeholder="Write a comment…"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.textPrimary }]}
          value={comment}
        />
        <View style={styles.composerFooter}>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>Visible on the task</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!comment.trim()}
            onPress={() => {
              const body = comment.trim();
              if (!body) return;
              onAddComment(body);
              setComment("");
            }}
            style={({ pressed }) => [
              styles.send,
              {
                backgroundColor: colors.textPrimary,
                opacity: !comment.trim() ? 0.4 : pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={{ color: colors.bgBase, fontWeight: "700" }}>Add comment</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Just now";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${hour}:${minute}`;
}

const styles = StyleSheet.create({
  authorRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  avatar: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  body: { fontSize: 15, lineHeight: 22, paddingLeft: 46 },
  comment: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  composer: { borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.sm },
  composerFooter: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  content: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.xxl },
  grow: { flex: 1 },
  heading: { flexDirection: "row", justifyContent: "space-between" },
  input: { minHeight: 92, padding: spacing.xs, textAlignVertical: "top" },
  send: {
    alignItems: "center",
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  srOnly: { height: 1, opacity: 0, position: "absolute", width: 1 },
  title: { fontSize: 20, fontWeight: "800" },
});
