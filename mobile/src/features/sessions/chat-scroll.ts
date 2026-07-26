export type ChatMessageList = {
  scrollToEnd(options: { animated: boolean }): void;
};

export function followLatestMessage(list: ChatMessageList | null): void {
  list?.scrollToEnd({ animated: true });
}
