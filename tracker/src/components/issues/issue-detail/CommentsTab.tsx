import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";
import { createComment, listComments } from "@/services/comments";
import type { Comment } from "@/types/comment";
import type { Issue } from "@/types/issue";

interface CommentsTabProps {
  projectSlug: string;
  issue: Issue;
}

export function CommentsTab({ projectSlug, issue }: CommentsTabProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");

  useEffect(() => {
    let active = true;
    void listComments(projectSlug, issue.identifier).then((items) => {
      if (active) setComments(items);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [issue.identifier, projectSlug]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    try {
      const comment = await createComment(projectSlug, issue.identifier, { body });
      setComments((current) => [...current, comment]);
      setBody("");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to add comment");
    }
  }

  return (
    <div className="space-y-4">
      <form className="space-y-2" onSubmit={handleSubmit}>
        <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a comment..." />
        <Button type="submit" size="sm">Comment</Button>
      </form>
      {comments.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}
      {comments.map((comment) => (
        <article key={comment.id} className="rounded-lg border p-3 text-sm">
          <div className="mb-2 text-xs text-muted-foreground">{comment.author || "Local user"} · {formatDateTime(comment.createdAt)}</div>
          <p className="whitespace-pre-wrap">{comment.body}</p>
        </article>
      ))}
    </div>
  );
}
