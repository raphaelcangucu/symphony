import { FormEvent, useEffect, useState } from "react";
import { ExternalLink, NotebookPen } from "lucide-react";
import { toast } from "sonner";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDateTime } from "@/lib/utils";
import { createComment, listComments } from "@/services/comments";
import type { Comment } from "@/types/comment";
import type { Issue } from "@/types/issue";

function sortByCreatedAt(comments: Comment[]): Comment[] {
  return [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

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
      if (active) setComments(sortByCreatedAt(items));
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
      setComments((current) => sortByCreatedAt([...current, comment]));
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
      {comments.map((comment) => {
        const isWorkpad = comment.kind === "workpad";
        return (
          <article
            key={comment.id}
            className={cn(
              "rounded-xl border p-3 text-sm",
              isWorkpad && "border-primary/40 bg-primary/5",
            )}
          >
            <header className="mb-2 flex items-center gap-2">
              <AssigneeAvatar login={comment.author} />
              <span className="text-xs font-medium text-foreground">{comment.author || "Local user"}</span>
              {isWorkpad ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <NotebookPen className="h-3 w-3" />
                  Workpad
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">· {formatDateTime(comment.createdAt)}</span>
              {comment.url ? (
                <a
                  href={comment.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  title="Open on GitHub"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </header>
            {comment.body.trim() ? (
              <Markdown>{comment.body}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">Empty comment.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
