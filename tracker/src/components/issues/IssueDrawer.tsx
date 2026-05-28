import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Issue } from "@/types/issue";

import { ActivityTab } from "./issue-detail/ActivityTab";
import { AgentTab } from "./issue-detail/AgentTab";
import { BlockersTab } from "./issue-detail/BlockersTab";
import { CommentsTab } from "./issue-detail/CommentsTab";
import { SummaryTab } from "./issue-detail/SummaryTab";
import { TerminalTab } from "./issue-detail/TerminalTab";

interface IssueDrawerProps {
  issue: Issue | null;
  projectSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IssueDrawer({ issue, projectSlug, open, onOpenChange }: IssueDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col overflow-hidden p-0">
        {issue ? (
          <>
            <SheetHeader className="border-b p-6 pb-4">
              <div className="font-mono text-xs text-muted-foreground">{issue.identifier}</div>
              <SheetTitle className="pr-8 text-xl leading-tight">{issue.title}</SheetTitle>
              <SheetDescription>{issue.status}</SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="summary" className="min-h-0 flex-1 overflow-hidden px-6 py-4">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="comments">Comments</TabsTrigger>
                <TabsTrigger value="blockers">Blockers</TabsTrigger>
                <TabsTrigger value="agent">Agent</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="terminal">Terminal</TabsTrigger>
              </TabsList>
              <div className="h-[calc(100%-3rem)] overflow-auto pr-1">
                <TabsContent value="summary"><SummaryTab issue={issue} /></TabsContent>
                <TabsContent value="comments"><CommentsTab projectSlug={projectSlug} issue={issue} /></TabsContent>
                <TabsContent value="blockers"><BlockersTab projectSlug={projectSlug} issue={issue} /></TabsContent>
                <TabsContent value="agent"><AgentTab issue={issue} /></TabsContent>
                <TabsContent value="activity"><ActivityTab issue={issue} /></TabsContent>
                <TabsContent value="terminal"><TerminalTab issue={issue} /></TabsContent>
              </div>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
